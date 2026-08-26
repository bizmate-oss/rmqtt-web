import { TopicStream, type StreamMessage } from './stream.svelte';
import type { MqttStatus } from '$lib/types';

/**
 * Full coverage of application topics, and the default for good reason.
 *
 * rmqtt's built-in ACL denies a subscription to exactly `#` for any client that
 * is not on the broker's own host, so a bare `#` fails for the common remote
 * deployment. `+/#` is not caught by that rule and still matches every topic at
 * every depth — `#` matches zero or more levels, so `+/#` matches `a` as well
 * as `a/b/c`. It also leaves out `$SYS`, which no wildcard matches unless named
 * explicitly, and which would otherwise swamp a list of application topics.
 */
export const DEFAULT_DISCOVERY_FILTER = '+/#';

/** Distinct topics retained before the least recently seen are evicted. */
const MAX_TOPICS = 5000;
const FLUSH_MS = 500;

export interface PublishedTopic {
	topic: string;
	/** Messages observed on this topic since discovery started. */
	messages: number;
	bytes: number;
	/** Smoothed messages per second. */
	rate: number;
	lastSeen: number;
	lastSize: number;
	/** QoS levels seen, ascending. */
	qos: number[];
	/** A retained message was observed, or the retain store lists this topic. */
	retained: boolean;
}

interface Accumulator {
	topic: string;
	messages: number;
	bytes: number;
	lastSeen: number;
	lastSize: number;
	qos: Set<number>;
	retained: boolean;
	/** Message count at the previous flush, for the rate calculation. */
	countAtFlush: number;
	rate: number;
}

/**
 * Concrete topics observed being published to.
 *
 * The broker exposes no list of published topics: `/api/v1/routes` and
 * `stats.topics.count` describe the routing table, which holds subscription
 * *filters*, not the topics messages actually arrive on. The only way to learn
 * the latter is to watch the traffic, which is what this does — through the
 * shared server-side bridge, so the broker still sees a single subscriber.
 *
 * Discovery runs while the Topics page is mounted and pauses when it is not, so
 * the dashboard never holds a wildcard subscription open in the background.
 * What has been observed is kept, so returning to the page continues the tally
 * rather than restarting it.
 */
class PublishedTopicsStore {
	filter = $state(DEFAULT_DISCOVERY_FILTER);
	observing = $state(false);
	status = $state<MqttStatus>('disabled');
	/** Filters the broker's ACL refused, so the page can explain the emptiness. */
	rejected = $state<Array<{ filter: string; error?: string }>>([]);
	dropped = $state(0);

	startedAt = $state(0);
	/** Total messages seen, including those on evicted topics. */
	totalMessages = $state(0);
	/** True once eviction has begun, so the page can say the list is partial. */
	evicting = $state(false);

	topics = $state<PublishedTopic[]>([]);

	#acc = new Map<string, Accumulator>();
	#stream: TopicStream | null = null;
	#timer: ReturnType<typeof setInterval> | null = null;
	#lastFlush = 0;

	get distinctTopics() {
		return this.topics.length;
	}

	get elapsedSeconds() {
		return this.startedAt ? Math.max(1, (Date.now() - this.startedAt) / 1000) : 0;
	}

	/** Starts, or resumes after a pause, keeping whatever was already observed. */
	start(filter = this.filter) {
		if (this.observing && filter === this.filter) return;
		this.#teardown();

		this.filter = filter;
		this.rejected = [];
		if (!this.startedAt) this.startedAt = Date.now();
		this.#lastFlush = Date.now();

		this.#stream = new TopicStream(
			[filter],
			(msg) => this.#ingest(msg),
			(status) => (this.status = status)
		);
		this.#stream.start();
		this.observing = true;
		this.#timer = setInterval(() => this.#flush(), FLUSH_MS);
	}

	/** Drops the subscription but keeps the tally. */
	pause() {
		this.#flush();
		this.#teardown();
		this.observing = false;
		// Rates stop meaning anything once messages stop arriving.
		this.topics = this.topics.map((t) => ({ ...t, rate: 0 }));
	}

	clear() {
		this.#acc.clear();
		this.topics = [];
		this.totalMessages = 0;
		this.evicting = false;
		this.dropped = 0;
		this.startedAt = this.observing ? Date.now() : 0;
		this.#lastFlush = Date.now();
	}

	#teardown() {
		this.#stream?.stop();
		this.#stream = null;
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
	}

	#ingest(msg: StreamMessage) {
		this.totalMessages++;

		let entry = this.#acc.get(msg.topic);
		if (!entry) {
			// A topic space keyed by uuid would grow without bound, so the least
			// recently seen entry makes way once the cap is reached.
			if (this.#acc.size >= MAX_TOPICS) {
				let oldestKey: string | undefined;
				let oldestSeen = Infinity;
				for (const [key, value] of this.#acc) {
					if (value.lastSeen < oldestSeen) {
						oldestSeen = value.lastSeen;
						oldestKey = key;
					}
				}
				if (oldestKey !== undefined) this.#acc.delete(oldestKey);
				this.evicting = true;
			}
			entry = {
				topic: msg.topic,
				messages: 0,
				bytes: 0,
				lastSeen: 0,
				lastSize: 0,
				qos: new Set(),
				retained: false,
				countAtFlush: 0,
				rate: 0
			};
			this.#acc.set(msg.topic, entry);
		}

		entry.messages++;
		entry.bytes += msg.payload.byteLength;
		entry.lastSeen = msg.ts;
		entry.lastSize = msg.payload.byteLength;
		entry.qos.add(msg.qos);
		if (msg.retain) entry.retained = true;
	}

	/**
	 * Publishes the accumulator into reactive state.
	 *
	 * Messages arrive far faster than the UI can render, so counting happens in
	 * a plain Map and only the periodic snapshot touches `$state`.
	 */
	#flush() {
		const now = Date.now();
		const seconds = Math.max((now - this.#lastFlush) / 1000, 0.001);
		this.#lastFlush = now;

		const snapshot: PublishedTopic[] = [];
		for (const entry of this.#acc.values()) {
			const delta = entry.messages - entry.countAtFlush;
			entry.countAtFlush = entry.messages;
			const instant = delta / seconds;
			// Smoothed so a 500ms window does not make the column flicker.
			entry.rate = entry.rate === 0 && delta === 0 ? 0 : instant * 0.6 + entry.rate * 0.4;

			snapshot.push({
				topic: entry.topic,
				messages: entry.messages,
				bytes: entry.bytes,
				rate: entry.rate,
				lastSeen: entry.lastSeen,
				lastSize: entry.lastSize,
				qos: [...entry.qos].sort((a, b) => a - b),
				retained: entry.retained
			});
		}
		this.topics = snapshot;
		this.dropped = this.#stream?.dropped ?? this.dropped;
		this.rejected = this.#stream?.rejected ?? [];
	}
}

export const publishedTopics = new PublishedTopicsStore();
