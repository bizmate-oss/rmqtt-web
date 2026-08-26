/**
 * Development traffic generator.
 *
 * Connects a handful of MQTT clients that publish, subscribe and leave retained
 * messages behind, so the dashboard has something to show while you work on it.
 * Not part of the application.
 *
 *   docker compose up -d rmqtt
 *   node scripts/dev-traffic.mjs
 */
import mqtt from 'mqtt';

const mk = (id, user, subs) => {
	const c = mqtt.connect('mqtt://127.0.0.1:1883', {
		clientId: id,
		username: user,
		clean: false,
		protocolVersion: 5,
		reconnectPeriod: 2000
	});
	c.on('connect', () => {
		if (subs.length) c.subscribe(subs, { qos: 1 });
	});
	c.on('error', () => {});
	return c;
};

const a = mk('sensor-a1', 'alice', ['demo/+/temp', '$share/g1/demo/work']);
const b = mk('sensor-b2', 'bob', ['demo/#']);
mk('gateway-1', 'carol', ['fleet/+/status', 'demo/x/temp']);
mk('logger-9', 'dave', ['#/nope']);
mk('edge-node-7', 'erin', ['fleet/#']);

setInterval(() => {
	a.publish(
		'demo/x/temp',
		JSON.stringify({ c: +(19 + Math.random() * 7).toFixed(2), ts: Date.now() }),
		{ qos: 0 }
	);
	a.publish(
		'demo/y/temp',
		JSON.stringify({ c: +(15 + Math.random() * 4).toFixed(2), ts: Date.now() }),
		{ qos: 1 }
	);
	b.publish(
		'fleet/truck-12/status',
		JSON.stringify({ speed: Math.round(Math.random() * 90), lat: 45.07, lon: 7.68 }),
		{ qos: 0 }
	);
}, 250);

// A few retained messages for the retained-messages page.
setTimeout(() => {
	a.publish('config/site/turin', JSON.stringify({ tz: 'Europe/Rome', interval: 30 }), {
		retain: true,
		qos: 1
	});
	a.publish('config/site/milan', JSON.stringify({ tz: 'Europe/Rome', interval: 60 }), {
		retain: true,
		qos: 1
	});
	a.publish('fleet/truck-12/lastseen', String(Date.now()), { retain: true, qos: 0 });
	a.publish('binary/blob', Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x7f, 0x80, 0x41, 0x42]), {
		retain: true,
		qos: 0
	});
}, 1500);
