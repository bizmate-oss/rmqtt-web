/**
 * Shapes returned by the rmqtt HTTP API (`rmqtt-http-api` plugin, /api/v1)
 * and by the $SYS system topics (`rmqtt-sys-topic` plugin).
 *
 * Field names are taken verbatim from docs/en_US/http-api.md and
 * docs/en_US/sys-topic.md — several of them contain dots, so they are always
 * indexed as string keys rather than accessed as properties.
 */

/** GET /api/v1/nodes — one entry per cluster node. */
export interface NodeInfo {
	node_id: number;
	node_name: string;
	running: boolean;
	version: string;
	rustc_version?: string;
	uptime: string;
	boottime: string;
	connections: number;
	memory_free: number;
	memory_total: number;
	memory_used: number;
	disk_free: number;
	disk_total: number;
	load1: number;
	load5: number;
	load15: number;
}

/** GET /api/v1/brokers */
export interface BrokerInfo {
	node_id?: number;
	node_name?: string;
	/** Broker-local wall clock, used to calibrate every other timestamp. */
	datetime?: string;
	sysdescr?: string;
	uptime?: string;
	version?: string;
	rustc_version?: string;
	running?: boolean;
}

/** GET /api/v1/health/check */
export interface HealthCheck {
	running?: boolean;
	nodes?: Array<{ node_id?: number; node_name?: string; running?: boolean; status?: string }>;
}

/** GET /api/v1/clients — cluster-wide client/session list. */
export interface ClientInfo {
	node_id: number;
	clientid: string;
	username: string;
	superuser: boolean;
	proto_ver: number;
	ip_address: string;
	port: number;
	connected: boolean;
	connected_at: string;
	disconnected_at: string;
	disconnected_reason?: string;
	keepalive: number;
	clean_start: boolean;
	session_present: boolean;
	expiry_interval: number;
	created_at: string;
	subscriptions_cnt: number;
	max_subscriptions: number;
	inflight: number;
	max_inflight: number;
	mqueue_len: number;
	max_mqueue: number;
	last_will?: { topic: string; qos: number; retain: boolean; message: string } | null;
}

/**
 * GET /api/v1/subscriptions.
 *
 * The docs describe flat `qos` and `share` fields, but rmqtt 0.23 returns an
 * `opts` object carrying the full MQTT 5 subscription options with the shared
 * group under `opts.group`. Both shapes are declared and read through the
 * `subQos` / `subShare` helpers below.
 */
export interface SubscriptionOpts {
	qos: number;
	no_local?: boolean;
	retain_as_published?: boolean;
	retain_handling?: number;
	/** Shared-subscription group, i.e. the `$share/{group}/` prefix. */
	group?: string | null;
}

export interface SubscriptionInfo {
	node_id: number;
	clientid: string;
	client_addr: string | null;
	topic: string;
	opts?: SubscriptionOpts;
	/** Pre-0.23 flat fields. */
	qos?: number;
	share?: string | null;
}

export function subQos(sub: SubscriptionInfo): number {
	return sub.opts?.qos ?? sub.qos ?? 0;
}

export function subShare(sub: SubscriptionInfo): string | null {
	return sub.opts?.group ?? sub.share ?? null;
}

/** GET /api/v1/routes — a topic that currently has at least one subscriber. */
export interface RouteInfo {
	node_id: number;
	topic: string;
}

/**
 * One entry of GET /api/v1/retains. `publish.payload` is base64.
 *
 * `msg_id` and `remaining_ttl` are frequently absent: rmqtt only fills the TTL
 * on the full-pagination path, and the RAM retainer reports no message id at all.
 */
export interface RetainedMessage {
	topic: string;
	msg_id?: number | null;
	/** Present on the observed 0.23 responses alongside `from.id.client_id`. */
	client_id?: string | null;
	from?: {
		typ?: string;
		id?: {
			node_id?: number;
			client_id?: string;
			username?: string;
			remote_addr?: string;
			create_time?: number;
		};
	} | null;
	publish: {
		topic?: string;
		qos: number;
		retain: boolean;
		dup?: boolean;
		payload: string;
		create_time: number;
		properties?: Record<string, unknown> | null;
	};
	remaining_ttl?: number | null;
}

/** Best-effort publisher identity for a retained message. */
export function retainedFrom(msg: RetainedMessage): string {
	return msg.client_id || msg.from?.id?.client_id || '—';
}

export interface RetainedPage {
	items: RetainedMessage[];
	has_more: boolean;
}

/** Dotted-key counter maps as published by /api/v1/stats and /api/v1/metrics. */
export type StatsMap = Record<string, number>;
export type MetricsMap = Record<string, number>;

/** GET /api/v1/stats — array, one element per node. */
export interface NodeStats {
	node: { id: number; name: string; running: boolean };
	stats: StatsMap;
}

/** GET /api/v1/stats/sum */
export interface StatsSum {
	nodes: Record<string, { name: string; running: boolean }>;
	stats: StatsMap;
}

/** GET /api/v1/metrics — array, one element per node. */
export interface NodeMetrics {
	node: { id: number; name: string };
	metrics: MetricsMap;
}

/** GET /api/v1/metrics/sum */
export interface MetricsSum {
	nodes?: Record<string, { name: string }>;
	metrics: MetricsMap;
}

/** GET /api/v1/{stats,metrics}/history/sum — requires history storage to be configured. */
export interface HistorySum {
	from: number;
	to: number;
	node_count: number;
	count: number;
	data: Array<{ ts: number } & Record<string, number>>;
}

export interface PluginInfo {
	name: string;
	version?: string | null;
	descr?: string | null;
	authors?: string[] | null;
	repository?: string | null;
	active: boolean;
	inited: boolean;
	immutable: boolean;
	attrs?: unknown;
}

/** GET /api/v1/plugins returns one entry per node, each holding the plugin list. */
export interface NodePlugins {
	node: number;
	plugins: PluginInfo[];
}

/* -------------------------------------------------------------------------- */
/*  $SYS topic payloads                                                        */
/* -------------------------------------------------------------------------- */

export type SysEventKind =
	'connected' | 'disconnected' | 'created' | 'terminated' | 'subscribed' | 'unsubscribed';

/** Payload of $SYS/brokers/{node}/clients|session/{clientid}/{event}. */
export interface SysEvent {
	kind: SysEventKind;
	node: number;
	clientid: string;
	username?: string;
	ipaddress?: string;
	topic?: string;
	reason?: string;
	opts?: { qos?: number };
	time: string;
	/** Local receive time (ms) — the broker's `time` string has no zone. */
	receivedAt: number;
}

/* -------------------------------------------------------------------------- */
/*  Dashboard-internal shapes                                                  */
/* -------------------------------------------------------------------------- */

/** One point in a rolling time series. */
export interface Point {
	ts: number;
	v: number;
}

export interface Series {
	key: string;
	label: string;
	color: string;
	points: Point[];
	/** Rendered as an area wash under the line. */
	area?: boolean;
}

/** A message captured by the on-demand topic monitor. */
export interface CapturedMessage {
	id: number;
	topic: string;
	payload: Uint8Array;
	qos: number;
	retain: boolean;
	dup: boolean;
	ts: number;
	properties?: Record<string, unknown>;
}

export type PayloadFormat = 'auto' | 'json' | 'text' | 'hex' | 'base64';

export type MqttStatus = 'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'error';
