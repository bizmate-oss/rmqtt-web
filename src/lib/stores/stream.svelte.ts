import { browser } from '$app/environment';
import { base64ToBytes } from '$lib/utils/payload';
import type { MqttStatus } from '$lib/types';

export interface StreamMessage {
	topic: string;
	payload: Uint8Array;
	qos: number;
	retain: boolean;
	dup: boolean;
	ts: number;
}

/**
 * Live MQTT traffic for a set of topic filters, delivered over server-sent
 * events from /api/stream. The broker connection itself lives on the server
 * (see $lib/server/mqtt) — this is only the browser end of it.
 */
export class TopicStream {
	status = $state<MqttStatus>('connecting');
	detail = $state<string | undefined>(undefined);
	/** Messages the server-side rate limiter discarded for this stream. */
	dropped = $state(0);
	/** The broker's answer per filter — its ACL can refuse one outright. */
	subscriptions = $state<Record<string, { ok: boolean; error?: string }>>({});

	#filters: string[];
	#onMessage: (msg: StreamMessage) => void;
	#onStatus?: (status: MqttStatus, detail?: string, clientId?: string) => void;
	#es: EventSource | null = null;

	constructor(
		filters: string[],
		onMessage: (msg: StreamMessage) => void,
		onStatus?: (status: MqttStatus, detail?: string, clientId?: string) => void
	) {
		this.#filters = filters;
		this.#onMessage = onMessage;
		this.#onStatus = onStatus;
	}

	/** Client id of the server-side bridge, reported with every status event. */
	bridgeClientId = $state<string | undefined>(undefined);

	#setStatus(status: MqttStatus, detail?: string, clientId?: string) {
		this.status = status;
		this.detail = detail;
		if (clientId) this.bridgeClientId = clientId;
		this.#onStatus?.(status, detail, clientId);
	}

	get connected() {
		return this.status === 'connected';
	}

	start() {
		if (!browser || this.#es) return;

		const params = new URLSearchParams();
		for (const f of this.#filters) params.append('t', f);

		const es = new EventSource(`/api/stream?${params}`);
		this.#es = es;

		es.addEventListener('status', (ev) => {
			const data = JSON.parse((ev as MessageEvent).data) as {
				status: string;
				detail?: string;
				clientId?: string;
			};
			// The bridge reports MQTT-level states; `offline` is folded into
			// `reconnecting` because MQTT.js retries on its own.
			this.#setStatus(
				data.status === 'offline' ? 'reconnecting' : (data.status as MqttStatus),
				data.detail,
				data.clientId
			);
		});

		es.addEventListener('message', (ev) => {
			const raw = JSON.parse((ev as MessageEvent).data) as {
				topic: string;
				payload: string;
				qos: number;
				retain: boolean;
				dup: boolean;
				ts: number;
			};
			this.#onMessage({ ...raw, payload: base64ToBytes(raw.payload) });
		});

		es.addEventListener('subscribed', (ev) => {
			const { filter, ok, error } = JSON.parse((ev as MessageEvent).data) as {
				filter: string;
				ok: boolean;
				error?: string;
			};
			this.subscriptions = { ...this.subscriptions, [filter]: { ok, error } };
		});

		es.addEventListener('dropped', (ev) => {
			const { count } = JSON.parse((ev as MessageEvent).data) as { count: number };
			this.dropped += count;
		});

		es.addEventListener('error', () => {
			// EventSource reconnects by itself; surface the gap rather than tear down.
			if (this.status !== 'disabled') this.#setStatus('reconnecting');
		});
	}

	get rejected(): Array<{ filter: string; error?: string }> {
		return Object.entries(this.subscriptions)
			.filter(([, r]) => !r.ok)
			.map(([filter, r]) => ({ filter, error: r.error }));
	}

	stop() {
		this.#es?.close();
		this.#es = null;
		this.subscriptions = {};
	}
}
