import type {
	BrokerInfo,
	ClientInfo,
	HealthCheck,
	HistorySum,
	MetricsSum,
	NodeInfo,
	NodeMetrics,
	NodePlugins,
	NodeStats,
	RetainedPage,
	RouteInfo,
	StatsSum,
	SubscriptionInfo
} from '$lib/types';

const BASE = '/api/rmqtt';

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number,
		readonly body?: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}

export type Query = Record<string, string | number | boolean | undefined | null>;

/**
 * Turns a failed response into something worth showing a person.
 *
 * The proxy reports unreachable-broker conditions as JSON `{error}`; rmqtt
 * answers with JSON or a bare string for most failures, but its HTTP layer
 * (salvo) serves a full HTML page for 404s — which must never end up in a toast.
 */
/**
 * Renders an unknown value as something a person can read.
 *
 * `String(value)` on an object yields "[object Object]", which is exactly what
 * a failed disconnect was showing when the broker answered with a structured
 * error rather than a bare string. Message-bearing keys are preferred, then the
 * JSON itself, so the operator always sees the broker's own words instead of a
 * placeholder.
 */
function describe(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value.trim();
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	if (value instanceof Error) return value.message;

	if (typeof value === 'object') {
		const record = value as Record<string, unknown>;
		// Only strings are taken from these keys, so a nested object cannot
		// recurse back into the "[object Object]" case.
		for (const key of ['message', 'reason', 'detail', 'details', 'description', 'error']) {
			const candidate = record[key];
			if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
		}
		try {
			const json = JSON.stringify(value);
			if (json && json !== '{}' && json !== '[]') return json;
		} catch {
			/* circular — fall through */
		}
	}
	return '';
}

function errorMessage(res: Response, text: string): string {
	const status = `${res.status} ${res.statusText}`.trim();
	const trimmed = text.trim();

	if (trimmed.startsWith('<')) {
		return res.status === 404
			? 'Not found — the client or resource no longer exists on the broker.'
			: status;
	}
	try {
		const parsed: unknown = JSON.parse(trimmed);
		if (parsed && typeof parsed === 'object' && 'error' in parsed) {
			return describe((parsed as { error: unknown }).error) || status;
		}
		// A parsed body with nothing readable in it (`{}`) is less use than the
		// status line; raw text only reaches the caller when JSON.parse fails.
		return describe(parsed) || status;
	} catch {
		/* not JSON — fall through to the raw text */
	}
	return trimmed || status;
}

/**
 * The message to show a person for a thrown value, never "[object Object]" and
 * never empty. Use this at every catch site that surfaces an error in the UI.
 */
export function errorText(err: unknown, fallback = 'Unexpected error'): string {
	if (err instanceof Error) return err.message.trim() || fallback;
	return describe(err) || fallback;
}

function qs(params?: Query): string {
	if (!params) return '';
	const sp = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		if (v === undefined || v === null || v === '') continue;
		sp.set(k, String(v));
	}
	const s = sp.toString();
	return s ? `?${s}` : '';
}

async function request<T>(
	method: string,
	path: string,
	opts: { query?: Query; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
	const res = await fetch(`${BASE}${path}${qs(opts.query)}`, {
		method,
		headers: opts.body === undefined ? undefined : { 'content-type': 'application/json' },
		body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
		signal: opts.signal
	});

	const text = await res.text();

	if (!res.ok) {
		throw new ApiError(errorMessage(res, text), res.status, text);
	}

	if (!text) return undefined as T;
	try {
		return JSON.parse(text) as T;
	} catch {
		// /mqtt/publish answers with the bare string `ok`, so a non-JSON body is
		// not by itself an error — but an HTML page never is a valid response.
		// rmqtt serves its embedded dashboard SPA for unknown /api/v1 paths, and
		// letting that through would surface as bizarre downstream type errors.
		if (text.trimStart().startsWith('<')) {
			throw new ApiError(
				`The broker returned an HTML page for ${path} instead of JSON. Check that RMQTT_API_URL points at the rmqtt-http-api listener.`,
				res.status,
				text
			);
		}
		return text as unknown as T;
	}
}

/** Filters accepted by GET /api/v1/clients. */
export interface ClientQuery extends Query {
	_limit?: number;
	clientid?: string;
	username?: string;
	ip_address?: string;
	connected?: boolean;
	clean_start?: boolean;
	session_present?: boolean;
	proto_ver?: number;
	_like_clientid?: string;
	_like_username?: string;
	_gte_mqueue_len?: number;
	_lte_mqueue_len?: number;
}

/** Filters accepted by GET /api/v1/subscriptions. */
export interface SubscriptionQuery extends Query {
	_limit?: number;
	clientid?: string;
	topic?: string;
	qos?: number;
	share?: string;
	_match_topic?: string;
}

export interface HistoryQuery extends Query {
	minutes?: number;
	hours?: number;
	days?: number;
	limit?: number;
	merge_window?: number;
}

export const api = {
	/* --- cluster ---------------------------------------------------------- */
	brokers: (signal?: AbortSignal) => request<BrokerInfo[]>('GET', '/brokers', { signal }),
	nodes: (signal?: AbortSignal) => request<NodeInfo[]>('GET', '/nodes', { signal }),
	node: (id: number, signal?: AbortSignal) => request<NodeInfo>('GET', `/nodes/${id}`, { signal }),
	health: (signal?: AbortSignal) => request<HealthCheck>('GET', '/health/check', { signal }),
	plugins: (signal?: AbortSignal) => request<NodePlugins[]>('GET', '/plugins', { signal }),

	/* --- stats & metrics -------------------------------------------------- */
	stats: (signal?: AbortSignal) => request<NodeStats[]>('GET', '/stats', { signal }),
	statsSum: (signal?: AbortSignal) => request<StatsSum>('GET', '/stats/sum', { signal }),
	metrics: (signal?: AbortSignal) => request<NodeMetrics[]>('GET', '/metrics', { signal }),
	metricsSum: (signal?: AbortSignal) => request<MetricsSum>('GET', '/metrics/sum', { signal }),

	/**
	 * History endpoints only answer when the rmqtt-http-api plugin has a
	 * `storage` backend configured; callers must tolerate a failure here and
	 * fall back to the client-side rolling buffer.
	 */
	statsHistorySum: (query: HistoryQuery, signal?: AbortSignal) =>
		request<HistorySum>('GET', '/stats/history/sum', { query, signal }),
	metricsHistorySum: (query: HistoryQuery, signal?: AbortSignal) =>
		request<HistorySum>('GET', '/metrics/history/sum', { query, signal }),
	statsHistoryNode: (node: number, query: HistoryQuery, signal?: AbortSignal) =>
		request<HistorySum>('GET', `/stats/history/${node}`, { query, signal }),
	metricsHistoryNode: (node: number, query: HistoryQuery, signal?: AbortSignal) =>
		request<HistorySum>('GET', `/metrics/history/${node}`, { query, signal }),

	/* --- clients ---------------------------------------------------------- */
	clients: (query: ClientQuery = {}, signal?: AbortSignal) =>
		request<ClientInfo[]>('GET', '/clients', { query, signal }),
	client: (clientid: string, signal?: AbortSignal) =>
		request<ClientInfo>('GET', `/clients/${encodeURIComponent(clientid)}`, { signal }),
	offlineClients: (query: ClientQuery = {}, signal?: AbortSignal) =>
		request<ClientInfo[]>('GET', '/clients/offlines', { query, signal }),
	/** DELETE /api/v1/clients/offlines — drops every offline session matching `query`. */
	kickOfflines: (query: ClientQuery = {}) =>
		request<{ kicked?: number } | number>('DELETE', '/clients/offlines', { query }),
	/**
	 * DELETE /api/v1/clients/{clientid} — terminates the connection.
	 * Answers with the disconnected client's identity, or 404 if it is already gone.
	 */
	kickClient: (clientid: string) =>
		request<{ clientid?: string; node?: number; ipaddress?: string }>(
			'DELETE',
			`/clients/${encodeURIComponent(clientid)}`
		),

	/* --- subscriptions & routes ------------------------------------------- */
	subscriptions: (query: SubscriptionQuery = {}, signal?: AbortSignal) =>
		request<SubscriptionInfo[]>('GET', '/subscriptions', { query, signal }),
	clientSubscriptions: (clientid: string, signal?: AbortSignal) =>
		request<SubscriptionInfo[]>('GET', `/subscriptions/${encodeURIComponent(clientid)}`, {
			signal
		}),
	routes: (query: Query = {}, signal?: AbortSignal) =>
		request<RouteInfo[]>('GET', '/routes', { query, signal }),

	/* --- retained messages ------------------------------------------------ */
	retains: (
		query: { topic_filter?: string; offset?: number; limit?: number } = {},
		signal?: AbortSignal
	) => request<RetainedPage>('GET', '/retains', { query, signal }),

	/* --- publish ---------------------------------------------------------- */
	publish: (body: {
		topic?: string;
		topics?: string;
		payload: string;
		encoding?: 'plain' | 'base64';
		qos?: number;
		retain?: boolean;
		clientid?: string;
	}) => request<string>('POST', '/mqtt/publish', { body }),

	/**
	 * Clears a retained message.
	 *
	 * Uses DELETE /api/v1/retains, which removes the stored value without
	 * publishing anything: verified against rmqtt 0.23, a client subscribed to
	 * the topic receives nothing.
	 *
	 * The fallback is the MQTT-native removal — a zero-length publish with the
	 * retain flag set — for brokers that predate the endpoint. It is second
	 * choice because the spec has the server treat that packet as a normal
	 * publication as well as a removal, so every live subscriber is handed a
	 * zero-length message (confirmed on the same broker). Consumers that do not
	 * expect an empty payload can choke on it.
	 */
	deleteRetained: async (topic: string) => {
		try {
			return await request<string>('DELETE', '/retains', { query: { topic } });
		} catch (err) {
			const missing =
				err instanceof ApiError && (err.status === 404 || err.status === 405 || err.status === 501);
			if (!missing) throw err;
			return request<string>('POST', '/mqtt/publish', {
				body: { topic, payload: '', encoding: 'plain', qos: 0, retain: true, clientid: 'rmqtt-web' }
			});
		}
	}
};

export interface RuntimeConfig {
	apiUrl: string;
	apiTokenConfigured: boolean;
	mqttConfigured: boolean;
	mqttUrl: string;
}

export async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
	const res = await fetch('/api/runtime-config');
	if (!res.ok) throw new ApiError('Cannot read dashboard runtime config', res.status);
	return res.json();
}
