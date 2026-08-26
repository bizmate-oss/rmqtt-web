import { api } from '$lib/api/client';
import { toText } from '$lib/utils/payload';
import { brokerClock } from './brokerClock.svelte';
import { TopicStream, type StreamMessage } from './stream.svelte';
import type {
	BrokerInfo,
	MetricsMap,
	NodeInfo,
	NodeMetrics,
	NodeStats,
	Point,
	StatsMap,
	SysEvent,
	SysEventKind
} from '$lib/types';

/** Rolling window kept in the browser for the "last hour" charts. */
export const WINDOW_MS = 60 * 60 * 1000;

/** Gauges — read straight off /api/v1/stats. */
export const TRACKED_STATS = [
	'connections.count',
	'sessions.count',
	'topics.count',
	'subscriptions.count',
	'subscriptions_shared.count',
	'routes.count',
	'retained.count',
	'handshakings.count',
	'in_inflights.count',
	'out_inflights.count',
	'message_queues.count'
] as const;

/** Monotonic counters — charted as per-second rates, never as raw totals. */
export const TRACKED_METRICS = [
	'messages.publish',
	'messages.delivered',
	'messages.acked',
	'messages.dropped',
	'messages.nonsubscribed',
	'client.connect',
	'client.connected',
	'client.disconnected',
	'client.subscribe',
	'client.unsubscribe',
	'session.created',
	'session.terminated'
] as const;

export type StatKey = (typeof TRACKED_STATS)[number];
export type MetricKey = (typeof TRACKED_METRICS)[number];

/**
 * Keys the broker spells differently from the documentation.
 *
 * rmqtt 0.23 publishes `retaineds.count` / `retaineds.max` where
 * docs/en_US/http-api.md documents `retained.count`. Both are accepted so the
 * dashboard works across versions instead of silently charting zero.
 */
const STAT_ALIASES: Partial<Record<StatKey, readonly string[]>> = {
	'retained.count': ['retaineds.count']
};

/** Reads a stat by its canonical key, falling back to any known alias. */
function readStat(map: Record<string, number> | undefined, key: StatKey): number | undefined {
	if (!map) return undefined;
	const direct = map[key];
	if (typeof direct === 'number') return direct;
	for (const alias of STAT_ALIASES[key] ?? []) {
		const v = map[alias];
		if (typeof v === 'number') return v;
	}
	return undefined;
}

/** One cluster-wide snapshot. Values are positional, matching the arrays above. */
interface Sample {
	ts: number;
	s: number[];
	m: number[];
}

/** The most recent $SYS publication seen from a node. */
export interface SysNodeSnapshot {
	node: number;
	stats?: StatsMap;
	metrics?: MetricsMap;
	statsAt?: number;
	metricsAt?: number;
}

function sumStats<T>(rows: T[], pick: (row: T) => Record<string, number>): StatsMap {
	const out: StatsMap = {};
	for (const key of TRACKED_STATS) out[key] = 0;
	for (const row of rows) {
		const map = pick(row);
		for (const key of TRACKED_STATS) {
			const v = readStat(map, key);
			// -1 is rmqtt's "module not enabled" sentinel (e.g. message_storages).
			if (typeof v === 'number' && v >= 0) out[key] += v;
		}
	}
	return out;
}

function sumMetrics<T>(rows: T[], pick: (row: T) => Record<string, number>): MetricsMap {
	const out: MetricsMap = {};
	for (const key of TRACKED_METRICS) out[key] = 0;
	for (const row of rows) {
		const map = pick(row) ?? {};
		for (const key of TRACKED_METRICS) {
			const v = map[key];
			if (typeof v === 'number' && v >= 0) out[key] += v;
		}
	}
	return out;
}

/**
 * Cluster-wide live state.
 *
 * Two sources feed this store and they do different jobs:
 *
 *  - The HTTP API is polled on a fixed cadence. Because the interval is regular,
 *    it is the only thing appended to the rolling sample buffer — deriving a
 *    per-second rate from irregularly spaced counter reads produces spikes that
 *    aren't in the data.
 *  - $SYS carries the push half: per-node stats/metrics as the broker publishes
 *    them (every `publish_interval`, 1m by default) and the client/session event
 *    feed, which has no HTTP equivalent.
 */
class ClusterStore {
	nodes = $state<NodeInfo[]>([]);
	nodeStats = $state<NodeStats[]>([]);
	nodeMetrics = $state<NodeMetrics[]>([]);
	brokers = $state<BrokerInfo[]>([]);

	stats = $state<StatsMap>({});
	metrics = $state<MetricsMap>({});

	loading = $state(true);
	error = $state<string | null>(null);
	loadedAt = $state(0);

	/** null until the first probe; false when history storage isn't configured. */
	historyAvailable = $state<boolean | null>(null);
	seededAt = $state(0);

	/** Live per-node data as published on $SYS. */
	sysNodes = $state<Record<number, SysNodeSnapshot>>({});
	sysEvents = $state<SysEvent[]>([]);
	sysStatus = $state<'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'error'>(
		'connecting'
	);
	sysDetail = $state<string | undefined>(undefined);
	lastSysAt = $state(0);
	/** Client id the dashboard's own MQTT bridge uses, so it can be filtered out. */
	bridgeClientId = $state<string | undefined>(undefined);

	#samples = $state<Sample[]>([]);
	#stream: TopicStream | null = null;
	#timer: ReturnType<typeof setInterval> | null = null;
	#intervalMs = 0;
	#started = false;

	/* ---------------------------------------------------------------- derived */

	get sampleCount() {
		return this.#samples.length;
	}

	get windowStart() {
		return this.#samples[0]?.ts ?? 0;
	}

	get runningNodes() {
		return this.nodes.filter((n) => n.running).length;
	}

	/** Current value of a gauge, cluster-wide. */
	stat(key: StatKey): number {
		return this.stats[key] ?? 0;
	}

	/**
	 * Latest per-second rate for a counter, from the two most recent samples.
	 * Returns 0 rather than a guess when only one sample exists.
	 */
	rateNow(key: MetricKey): number {
		const n = this.#samples.length;
		if (n < 2) return 0;
		const i = TRACKED_METRICS.indexOf(key);
		const a = this.#samples[n - 2];
		const b = this.#samples[n - 1];
		return deltaRate(a.m[i], b.m[i], b.ts - a.ts);
	}

	/** Gauge history over the rolling window. */
	statSeries(key: StatKey): Point[] {
		const i = TRACKED_STATS.indexOf(key);
		return this.#samples.map((s) => ({ ts: s.ts, v: s.s[i] }));
	}

	/** Counter history converted to per-second rates. One point shorter than the buffer. */
	rateSeries(key: MetricKey): Point[] {
		const i = TRACKED_METRICS.indexOf(key);
		const out: Point[] = [];
		for (let k = 1; k < this.#samples.length; k++) {
			const a = this.#samples[k - 1];
			const b = this.#samples[k];
			out.push({ ts: b.ts, v: deltaRate(a.m[i], b.m[i], b.ts - a.ts) });
		}
		return out;
	}

	/* ----------------------------------------------------------- lifecycle */

	start(intervalMs: number) {
		this.#intervalMs = intervalMs;
		if (!this.#started) {
			this.#started = true;
			void this.#seedHistory();
			this.#startStream();
		}
		void this.refresh();
		this.#restartTimer();
	}

	setInterval(intervalMs: number) {
		if (intervalMs === this.#intervalMs) return;
		this.#intervalMs = intervalMs;
		this.#restartTimer();
	}

	#restartTimer() {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
		if (this.#intervalMs > 0) {
			this.#timer = setInterval(() => void this.refresh(), this.#intervalMs);
		}
	}

	/** The store is a singleton shared by every page, so nothing tears it down. */
	stop() {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
		this.#stream?.stop();
		this.#stream = null;
		this.#started = false;
	}

	async refresh() {
		try {
			const [nodes, stats, metrics, brokers] = await Promise.all([
				api.nodes(),
				api.stats(),
				api.metrics(),
				api.brokers()
			]);
			this.nodes = nodes;
			this.nodeStats = stats;
			this.nodeMetrics = metrics;
			this.brokers = brokers;

			// Calibrate the broker's wall clock so relative times are right even
			// when the broker runs in a different timezone (UTC in the container).
			brokerClock.sync(brokers[0]?.datetime);

			// Summed from the same snapshot rather than read from /stats/sum, so
			// the cluster totals and the per-node rows can never disagree.
			this.stats = sumStats(stats, (r) => r.stats);
			this.metrics = sumMetrics(metrics, (r) => r.metrics);

			this.#record(Date.now(), this.stats, this.metrics);
			this.error = null;
			this.loadedAt = Date.now();
		} catch (err) {
			this.error = err instanceof Error ? err.message : 'Cannot reach the broker';
		} finally {
			this.loading = false;
		}
	}

	/* ------------------------------------------------------ sample buffer */

	#record(ts: number, stats: StatsMap, metrics: MetricsMap) {
		const last = this.#samples[this.#samples.length - 1];
		// Guard against double refreshes (a manual click landing on a tick).
		if (last && ts - last.ts < 500) return;

		const sample: Sample = {
			ts,
			s: TRACKED_STATS.map((k) => stats[k] ?? 0),
			m: TRACKED_METRICS.map((k) => metrics[k] ?? 0)
		};

		const cutoff = ts - WINDOW_MS;
		const kept = this.#samples.filter((s) => s.ts >= cutoff);
		this.#samples = [...kept, sample];
	}

	/**
	 * Backfills the rolling window from /stats/history and /metrics/history.
	 *
	 * Those endpoints only answer when the rmqtt-http-api plugin has a `storage`
	 * backend configured. When they don't, the dashboard falls back to charting
	 * only what it has observed since the page was opened, and says so.
	 */
	async #seedHistory() {
		try {
			const [statsHistory, metricsHistory] = await Promise.all([
				api.statsHistorySum({ hours: 1, limit: 720 }),
				api.metricsHistorySum({ hours: 1, limit: 720 })
			]);

			// rmqtt answers these endpoints newest-first; the rate maths below and
			// the sample buffer both assume oldest-first.
			const asc = <T extends { ts: number }>(rows: T[]) =>
				rows.length < 2 || rows[0].ts <= rows[rows.length - 1].ts ? rows : [...rows].reverse();

			const statPoints = asc(statsHistory?.data ?? []);
			const metricPoints = asc(metricsHistory?.data ?? []);
			if (statPoints.length === 0) {
				this.historyAvailable = false;
				return;
			}

			// The two series are flushed by the same timer but written separately,
			// so they are joined on nearest timestamp rather than by index.
			const seeded: Sample[] = [];
			let j = 0;
			for (const sp of statPoints) {
				while (
					j + 1 < metricPoints.length &&
					Math.abs(metricPoints[j + 1].ts - sp.ts) <= Math.abs(metricPoints[j].ts - sp.ts)
				) {
					j++;
				}
				const mp = metricPoints[j];
				const aligned = mp && Math.abs(mp.ts - sp.ts) < 30_000 ? mp : undefined;
				seeded.push({
					ts: sp.ts,
					s: TRACKED_STATS.map((k) => readStat(sp, k) ?? 0),
					m: TRACKED_METRICS.map((k) => aligned?.[k] ?? 0)
				});
			}

			const cutoff = Date.now() - WINDOW_MS;
			const fresh = seeded.filter((s) => s.ts >= cutoff).sort((a, b) => a.ts - b.ts);

			// Anything already collected live wins over the backfill.
			const earliestLive = this.#samples[0]?.ts ?? Infinity;
			this.#samples = [...fresh.filter((s) => s.ts < earliestLive), ...this.#samples];

			this.historyAvailable = true;
			this.seededAt = Date.now();
		} catch {
			this.historyAvailable = false;
		}
	}

	/* ---------------------------------------------------------------- $SYS */

	#startStream() {
		// One filter covers node stats/metrics and every client/session event.
		// Client ids may contain '/', so the event topics are matched with '#'
		// and split by hand rather than with a '+' at the client-id level.
		this.#stream = new TopicStream(
			['$SYS/#'],
			(msg) => this.#ingest(msg),
			(status, detail, clientId) => {
				this.sysStatus = status;
				this.sysDetail = detail;
				if (clientId) this.bridgeClientId = clientId;
			}
		);
		this.#stream.start();
	}

	#ingest(msg: StreamMessage) {
		const parts = msg.topic.split('/');
		if (parts[0] !== '$SYS' || parts[1] !== 'brokers') return;
		const node = Number(parts[2]);
		const kind = parts[3];

		let body: unknown;
		try {
			body = JSON.parse(toText(msg.payload));
		} catch {
			return;
		}

		if (kind === 'stats' || kind === 'metrics') {
			const prev = this.sysNodes[node] ?? { node };
			this.sysNodes = {
				...this.sysNodes,
				[node]:
					kind === 'stats'
						? { ...prev, stats: body as StatsMap, statsAt: msg.ts }
						: { ...prev, metrics: body as MetricsMap, metricsAt: msg.ts }
			};
			this.lastSysAt = msg.ts;
			return;
		}

		if (kind !== 'clients' && kind !== 'session') return;

		const event = parts[parts.length - 1] as SysEventKind;
		const payload = body as Record<string, unknown>;
		const entry: SysEvent = {
			kind: event,
			node: typeof payload.node === 'number' ? payload.node : node,
			clientid: String(payload.clientid ?? parts.slice(4, -1).join('/')),
			username: payload.username as string | undefined,
			ipaddress: payload.ipaddress as string | undefined,
			topic: payload.topic as string | undefined,
			reason: payload.reason as string | undefined,
			opts: payload.opts as { qos?: number } | undefined,
			time: String(payload.time ?? ''),
			receivedAt: msg.ts
		};

		// The bridge's own subscribe/connect churn is not cluster activity.
		if (entry.clientid && entry.clientid === this.bridgeClientId) return;

		this.sysEvents = [entry, ...this.sysEvents].slice(0, 300);
		this.lastSysAt = msg.ts;
	}

	clearEvents() {
		this.sysEvents = [];
	}
}

/**
 * Per-second rate between two counter reads.
 *
 * A negative delta means the counter was reset — a node restarted, or the
 * cluster membership changed under the summed total — so it reports 0 instead
 * of a large negative spike.
 */
function deltaRate(before: number, after: number, dtMs: number): number {
	if (!dtMs || dtMs <= 0) return 0;
	const delta = after - before;
	if (delta < 0) return 0;
	return (delta / dtMs) * 1000;
}

export const cluster = new ClusterStore();
export { readStat };
