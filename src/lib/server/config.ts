import { env } from '$env/dynamic/private';

/**
 * Server-side connection settings, read from the environment at runtime (not
 * build time) so one build can be pointed at a different cluster.
 */
export const rmqtt = {
	/** Base URL of the rmqtt-http-api listener, without the /api/v1 suffix. */
	apiUrl: (env.RMQTT_API_URL ?? 'http://127.0.0.1:6060').replace(/\/+$/, ''),
	/** Matches `http_bearer_token` in plugins/rmqtt-http-api.toml. Empty = no auth. */
	apiToken: env.RMQTT_API_TOKEN ?? '',
	apiTimeoutMs: Number(env.RMQTT_API_TIMEOUT_MS ?? 10_000),

	/**
	 * MQTT endpoint used for $SYS live data and the on-demand topic monitor.
	 * This connection is made by the dashboard *server*, not the browser:
	 * rmqtt's built-in ACL only lets clients on the local machine subscribe to
	 * $SYS, and it keeps broker credentials out of the client bundle.
	 * Set to an empty string to disable live streaming and poll over HTTP only.
	 */
	mqttUrl: env.RMQTT_MQTT_URL ?? 'mqtt://127.0.0.1:1883',
	/**
	 * Defaults to `dashboard` because rmqtt's built-in ACL ships with
	 *   ["allow", { user = "dashboard" }, "subscribe", ["$SYS/#"]]
	 * which is the only rule that grants $SYS to a client that is not on the
	 * broker's own host. Change it only alongside plugins/rmqtt-acl.toml.
	 */
	mqttUsername: env.RMQTT_MQTT_USERNAME ?? 'dashboard',
	mqttPassword: env.RMQTT_MQTT_PASSWORD || undefined,
	mqttClientId: env.RMQTT_MQTT_CLIENT_ID ?? '',
	/** Cap on how many messages/second the monitor relays to a single browser. */
	monitorRateLimit: Number(env.RMQTT_MONITOR_RATE_LIMIT ?? 500)
};
