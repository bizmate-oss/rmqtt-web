import { rmqtt } from '$lib/server/config';
import { json } from '@sveltejs/kit';

/**
 * Non-secret configuration the browser needs at boot. Broker credentials are
 * deliberately absent: the MQTT connection lives on the server (see
 * $lib/server/mqtt) and reaches the browser through /api/stream.
 */
export function GET() {
	return json({
		apiUrl: rmqtt.apiUrl,
		apiTokenConfigured: Boolean(rmqtt.apiToken),
		mqttConfigured: Boolean(rmqtt.mqttUrl),
		mqttUrl: rmqtt.mqttUrl
	});
}
