import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import { rmqtt } from './config';

export interface BridgeMessage {
	topic: string;
	/** Base64 — payloads are arbitrary bytes and have to survive JSON/SSE. */
	payload: string;
	qos: number;
	retain: boolean;
	dup: boolean;
	ts: number;
}

export type BridgeStatus =
	'disabled' | 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'error';

type MessageListener = (msg: BridgeMessage) => void;
type StatusListener = (status: BridgeStatus, detail?: string) => void;

/** Outcome of a SUBSCRIBE — the broker's ACL can refuse a filter outright. */
export interface SubscribeResult {
	filter: string;
	ok: boolean;
	error?: string;
}

interface Sub {
	filter: string;
	listener: MessageListener;
	matcher: (topic: string) => boolean;
	onResult?: (result: SubscribeResult) => void;
}

/**
 * A single MQTT connection shared by every browser session.
 *
 * Browsers subscribe through /api/stream rather than connecting themselves, so
 * the broker sees one client no matter how many dashboards are open, and topic
 * filters are reference-counted: a filter is unsubscribed upstream only once
 * the last interested stream has gone away.
 */
class Bridge {
	client: MqttClient | null = null;
	status: BridgeStatus = rmqtt.mqttUrl ? 'connecting' : 'disabled';
	detail: string | undefined;
	/** The bridge's own MQTT client id, so the UI can exclude it from the feed. */
	clientId: string | undefined;

	#subs = new Set<Sub>();
	#refs = new Map<string, number>();
	#results = new Map<string, SubscribeResult>();
	#statusListeners = new Set<StatusListener>();

	ensureStarted() {
		if (this.client || !rmqtt.mqttUrl) return;

		const clientId = rmqtt.mqttClientId || `rmqtt-web-${Math.random().toString(16).slice(2, 10)}`;
		this.clientId = clientId;

		this.client = mqtt.connect(rmqtt.mqttUrl, {
			clientId,
			username: rmqtt.mqttUsername,
			password: rmqtt.mqttPassword,
			clean: true,
			keepalive: 30,
			reconnectPeriod: 5_000,
			connectTimeout: 10_000,
			protocolVersion: 5,
			// MQTT.js replays the active subscriptions itself after a reconnect,
			// which is required here because `clean: true` makes the broker forget
			// them. Re-sending them by hand as well would double every SUBSCRIBE.
			resubscribe: true
		});

		this.client.on('connect', () => this.#setStatus('connected'));
		this.client.on('reconnect', () => this.#setStatus('reconnecting'));
		this.client.on('close', () => {
			if (this.status === 'connected') this.#setStatus('offline');
		});
		this.client.on('error', (err) => this.#setStatus('error', err.message));
		this.client.on('message', (topic, payload, packet) => {
			const msg: BridgeMessage = {
				topic,
				payload: payload.toString('base64'),
				qos: packet.qos ?? 0,
				retain: Boolean(packet.retain),
				dup: Boolean(packet.dup),
				ts: Date.now()
			};
			for (const sub of this.#subs) {
				if (sub.matcher(topic)) sub.listener(msg);
			}
		});
	}

	#setStatus(status: BridgeStatus, detail?: string) {
		this.status = status;
		this.detail = detail;
		for (const l of this.#statusListeners) l(status, detail);
	}

	onStatus(listener: StatusListener): () => void {
		this.#statusListeners.add(listener);
		return () => this.#statusListeners.delete(listener);
	}

	/**
	 * Sends the SUBSCRIBE and records the outcome.
	 *
	 * rmqtt's built-in ACL refuses some filters — notably a bare `#` from any
	 * address other than the broker's own host — and MQTT.js surfaces that as an
	 * error on the callback while still reporting a granted QoS, so the error
	 * argument is the only reliable signal.
	 */
	#send(filter: string) {
		this.client?.subscribe(filter, { qos: 0 }, (err) => {
			const result: SubscribeResult = err
				? { filter, ok: false, error: err.message }
				: { filter, ok: true };
			this.#results.set(filter, result);
			for (const sub of this.#subs) {
				if (sub.filter === filter) sub.onResult?.(result);
			}
		});
	}

	/**
	 * Subscribes `filter` and streams matching messages until the returned fn is
	 * called. `onResult` fires once with the broker's answer to the SUBSCRIBE.
	 */
	subscribe(
		filter: string,
		listener: MessageListener,
		onResult?: (result: SubscribeResult) => void
	): () => void {
		this.ensureStarted();

		const sub: Sub = { filter, listener, matcher: compileFilter(filter), onResult };
		this.#subs.add(sub);

		const refs = this.#refs.get(filter) ?? 0;
		this.#refs.set(filter, refs + 1);
		if (refs === 0) {
			this.#send(filter);
		} else {
			// Already subscribed upstream — replay the remembered outcome.
			const cached = this.#results.get(filter);
			if (cached) onResult?.(cached);
		}

		return () => {
			if (!this.#subs.delete(sub)) return;
			const left = (this.#refs.get(filter) ?? 1) - 1;
			if (left <= 0) {
				this.#refs.delete(filter);
				this.#results.delete(filter);
				this.client?.unsubscribe(filter);
			} else {
				this.#refs.set(filter, left);
			}
		};
	}
}

/**
 * Compiles an MQTT topic filter into a matcher.
 *
 * Implements the MQTT 3.1.1/5 rules: `+` matches exactly one level, `#` matches
 * the rest (including zero levels), and neither wildcard matches a topic whose
 * first level starts with `$` unless the filter names it explicitly.
 */
export function compileFilter(filter: string): (topic: string) => boolean {
	const parts = filter.split('/');
	const guardsDollar = !parts[0]?.startsWith('$');

	return (topic: string) => {
		const levels = topic.split('/');
		if (guardsDollar && levels[0]?.startsWith('$')) return false;

		for (let i = 0; i < parts.length; i++) {
			const p = parts[i];
			if (p === '#') return true; // matches this level and everything below
			if (i >= levels.length) return false;
			if (p !== '+' && p !== levels[i]) return false;
		}
		return parts.length === levels.length;
	};
}

// Kept on globalThis so Vite's dev-time module reloads don't leak connections.
const KEY = Symbol.for('rmqtt-web.bridge');
const store = globalThis as unknown as Record<symbol, Bridge | undefined>;

export function getBridge(): Bridge {
	if (!store[KEY]) store[KEY] = new Bridge();
	const bridge = store[KEY]!;
	bridge.ensureStarted();
	return bridge;
}
