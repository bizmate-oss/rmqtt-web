import { getBridge, type BridgeMessage } from '$lib/server/mqtt';
import { rmqtt } from '$lib/server/config';
import type { RequestHandler } from './$types';

/**
 * Server-sent events carrying live MQTT traffic to one browser tab.
 *
 * Topic filters are passed as repeated `t` parameters (repeated rather than
 * comma-separated because a comma is a legal character in an MQTT topic):
 *
 *   /api/stream?t=%24SYS%2Fbrokers%2F%2B%2Fstats&t=%24SYS%2Fbrokers%2F%2B%2Fmetrics
 *
 * Emits four event types: `status` (bridge connection state), `subscribed`
 * (the broker's answer to each SUBSCRIBE, which its ACL may refuse), `message`
 * (a received publication, payload base64-encoded) and `dropped` (how many
 * messages the per-stream rate limit discarded).
 */
export const GET: RequestHandler = ({ url, request }) => {
	const filters = url.searchParams.getAll('t').filter(Boolean).slice(0, 16);
	const bridge = getBridge();

	const encoder = new TextEncoder();
	const cleanups: Array<() => void> = [];

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			let closed = false;

			const send = (event: string, data: unknown) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					closed = true;
				}
			};

			send('status', {
				status: bridge.status,
				detail: bridge.detail,
				clientId: bridge.clientId,
				filters
			});
			cleanups.push(
				bridge.onStatus((status, detail) =>
					send('status', { status, detail, clientId: bridge.clientId })
				)
			);

			// Per-stream rate limit. A monitor pointed at `#` on a busy broker can
			// otherwise push more than the browser can render, and the backpressure
			// lands on the broker connection shared by every other session.
			let windowStart = Date.now();
			let inWindow = 0;
			let dropped = 0;

			const onMessage = (msg: BridgeMessage) => {
				const now = Date.now();
				if (now - windowStart >= 1000) {
					if (dropped > 0) {
						send('dropped', { count: dropped, since: windowStart });
						dropped = 0;
					}
					windowStart = now;
					inWindow = 0;
				}
				if (inWindow >= rmqtt.monitorRateLimit) {
					dropped++;
					return;
				}
				inWindow++;
				send('message', msg);
			};

			for (const filter of filters) {
				cleanups.push(bridge.subscribe(filter, onMessage, (result) => send('subscribed', result)));
			}

			// Comment frames keep intermediaries from treating the stream as idle.
			const heartbeat = setInterval(() => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(': ping\n\n'));
				} catch {
					closed = true;
				}
			}, 20_000);
			cleanups.push(() => clearInterval(heartbeat));

			const abort = () => {
				closed = true;
				for (const fn of cleanups.splice(0)) fn();
				try {
					controller.close();
				} catch {
					/* already closed */
				}
			};
			request.signal.addEventListener('abort', abort, { once: true });
			cleanups.push(() => request.signal.removeEventListener('abort', abort));
		},
		cancel() {
			for (const fn of cleanups.splice(0)) fn();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-store, no-transform',
			connection: 'keep-alive',
			// Nginx buffers proxied responses by default, which stalls SSE.
			'x-accel-buffering': 'no'
		}
	});
};
