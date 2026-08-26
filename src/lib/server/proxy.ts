import { rmqtt } from './config';

const PREFIX = '/api/rmqtt';

/**
 * Forwards a browser request to the rmqtt HTTP API.
 *
 * The browser cannot call the broker directly: the API sends no CORS headers,
 * and the bearer token must not be shipped to the client. Everything under
 * /api/rmqtt/* is relayed to {RMQTT_API_URL}/api/v1/* by this function.
 *
 * The path is taken from the *encoded* pathname rather than from the route
 * params, because client ids and topics legitimately contain `/`, `+` and `#`
 * and must reach the broker with the caller's percent-encoding intact.
 */
export async function forward(request: Request): Promise<Response> {
	const url = new URL(request.url);

	if (!url.pathname.startsWith(PREFIX)) {
		return json({ error: 'Not a proxy path' }, 404);
	}
	const rest = url.pathname.slice(PREFIX.length) || '/';

	// The host is fixed, but a path can still climb out of /api/v1 — URL parsing
	// resolves `..` segments, including percent-encoded ones, so the check has to
	// run on the *parsed* target rather than on the raw string.
	let target: URL;
	try {
		target = new URL(`${rmqtt.apiUrl}/api/v1${rest}${url.search}`);
	} catch {
		return json({ error: 'Invalid path' }, 400);
	}

	const base = new URL(`${rmqtt.apiUrl}/api/v1/`);
	if (target.origin !== base.origin || !target.pathname.startsWith(base.pathname.slice(0, -1))) {
		return json({ error: 'Invalid path' }, 400);
	}

	const headers = new Headers({ accept: 'application/json' });
	if (rmqtt.apiToken) headers.set('authorization', `Bearer ${rmqtt.apiToken}`);

	let body: string | undefined;
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		body = await request.text();
		if (body) headers.set('content-type', 'application/json');
	}

	let upstream: Response;
	try {
		upstream = await fetch(target, {
			method: request.method,
			headers,
			body,
			signal: AbortSignal.timeout(rmqtt.apiTimeoutMs)
		});
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		const timedOut = err instanceof Error && err.name === 'TimeoutError';
		return json(
			{
				error: timedOut
					? `The broker at ${rmqtt.apiUrl} did not respond within ${rmqtt.apiTimeoutMs} ms.`
					: `Cannot reach the rmqtt HTTP API at ${rmqtt.apiUrl}: ${reason}`,
				upstream: rmqtt.apiUrl
			},
			504
		);
	}

	// rmqtt answers with JSON for most routes but with the bare string `ok`
	// for /mqtt/publish, so the upstream content-type is passed through as-is.
	const text = await upstream.text();
	return new Response(text, {
		status: upstream.status,
		headers: {
			'content-type': upstream.headers.get('content-type') ?? 'text/plain; charset=utf-8',
			'cache-control': 'no-store'
		}
	});
}

function json(data: unknown, status: number) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}
