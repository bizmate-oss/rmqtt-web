# rmqtt-web

A monitoring and control dashboard for an [RMQTT](https://github.com/rmqtt/rmqtt)
broker cluster, built with SvelteKit (Svelte 5) and Tailwind CSS 4.

It reads live cluster state from the `$SYS` system topics over MQTT and drives
the deployment through the rmqtt HTTP API, in the spirit of the EMQX dashboard.

## What it shows

| Page                  | What it does                                                                                                                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Overview**          | Nodes in the cluster, incoming message rate, connected clients, topics and subscriptions — each with its last value and a last-hour trend. Four last-hour charts (throughput, connections/sessions, topics/subscriptions, dropped/undelivered), a per-node health strip, and a live `$SYS` activity feed. |
| **Nodes**             | Every node with per-node workload and host resources: clients, sessions, subscriptions, memory and disk meters, load averages, uptime, version.                                                                                                                                                           |
| **Node detail**       | One node's counters, full metrics broken out by subsystem, and last-hour charts from that node's history.                                                                                                                                                                                                 |
| **Clients**           | Every session in the cluster, filterable by client id, username, IP, connection state and protocol version. **Disconnect** one client or a selection, drop offline sessions, and inspect a session's full detail with its subscriptions and `$SYS` events.                                                |
| **Subscriptions**     | Every subscription, flat or aggregated by topic filter, with subscriber counts, QoS distribution, node spread and shared groups.                                                                                                                                                                          |
| **Topics**            | The cluster routing table merged with every topic holding retained state, with an entry point to the monitor.                                                                                                                                                                                             |
| **Topic monitor**     | Subscribe to any filter on demand and stream messages live, with JSON/text/hex/base64 formatting, pause, search, and export to JSON, NDJSON or CSV.                                                                                                                                                       |
| **Retained messages** | Browse retained state by topic filter with pagination, inspect payloads, and **clear** them individually or in bulk.                                                                                                                                                                                      |
| **Settings**          | Dashboard preferences, broker connection status, clock calibration, history-storage availability and plugin activation state.                                                                                                                                                                             |

Every table exports to CSV, and every chart has a table view.

## Quick start

Against a broker you already run:

```bash
npm install
cp .env.example .env      # point RMQTT_API_URL / RMQTT_MQTT_URL at your broker
npm run dev
```

Or bring up a throwaway broker alongside it:

```bash
docker compose up -d rmqtt   # broker on 1883 / 6060, $SYS publisher enabled
npm run dev
```

The whole stack in containers:

```bash
docker compose up -d         # dashboard on http://localhost:3000
```

## Container image

Every push to `main` and every `v*.*.*` tag publishes a multi-arch image to
GitHub Container Registry from
[`.github/workflows/publish-image.yml`](.github/workflows/publish-image.yml).

```bash
docker run --rm -p 3000:3000 \
  -e RMQTT_API_URL=http://your-broker:6060 \
  -e RMQTT_MQTT_URL=mqtt://your-broker:1883 \
  ghcr.io/bizmate-oss/rmqtt-web:latest
```

|            |                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| Platforms  | `linux/amd64`, `linux/arm64`                                                                              |
| Tags       | `latest` (default branch), the branch name, `sha-<full-sha>`, and for a `v1.2.3` tag: `1.2.3`, `1.2`, `1` |
| Provenance | A signed build attestation is pushed alongside the image                                                  |

Each platform is built on a runner of its own architecture rather than under
QEMU: the image runs `npm ci` and a Vite build, both slow and occasionally
flaky when Node is emulated. The per-arch images are pushed by digest and
joined into one manifest list, so a single tag serves both. Pull requests build
without pushing, so a fork cannot publish.

Verify the attestation before trusting a pull:

```bash
gh attestation verify oci://ghcr.io/bizmate-oss/rmqtt-web:latest --repo bizmate-oss/rmqtt-web
```

### Making the package public — a one-time manual step

**A new GHCR package is private, and it does not inherit the repository's
visibility** — a public repo still gets a private package. The Packages REST
API has no endpoint that changes visibility (only list, get, delete and
restore), so no workflow can do this. It has to be done once, by hand:

1. Open <https://github.com/bizmate-oss/rmqtt-web/pkgs/container/rmqtt-web>
   (or the organisation's [Packages tab](https://github.com/orgs/bizmate-oss/packages))
2. **Package settings** (gear, right-hand side)
3. **Danger Zone** → **Change visibility** → **Public**, then confirm by typing
   the package name

If **Public** is not offered, an organisation owner has to allow it first, under
**Organisation settings → Packages → Package creation**. A package cannot be
made private again once public.

The workflow probes the registry anonymously after every publish and, when the
image is not pullable, reports whether the API calls it `private` or `internal`
and names these steps — so a silently-private image does not go unnoticed.

## Broker requirements

Three plugins matter. The Settings page reports which are active and what each
one costs you if it isn't.

| Plugin            | Needed for                                                            | Default |
| ----------------- | --------------------------------------------------------------------- | ------- |
| `rmqtt-http-api`  | Everything — all cluster reads and control actions                    | **on**  |
| `rmqtt-sys-topic` | The `$SYS` live feed: node stats/metrics pushes and the activity feed | **off** |
| `rmqtt-retainer`  | The retained messages page                                            | **on**  |

Enable the `$SYS` publisher for the current run:

```bash
curl -X PUT http://localhost:6060/api/v1/plugins/1/rmqtt-sys-topic/load
```

or permanently, by adding `rmqtt-sys-topic` to `plugins.default_startups` in
`rmqtt.toml`.

### The `$SYS` ACL

rmqtt's built-in ACL (`plugins/rmqtt-acl.toml`) ships with:

```toml
["allow", { user = "dashboard" }, "subscribe", ["$SYS/#"]],
["allow", { ipaddr = "127.0.0.1" }, "pubsub", ["$SYS/#", "#"]],
["deny",  "all", "subscribe", ["$SYS/#", { eq = "#" }]],
```

So `$SYS/#` is reachable either from the broker's own host, or by a client
connecting with the username **`dashboard`** — which is why
`RMQTT_MQTT_USERNAME` defaults to that. The same rules mean a bare `#`
subscription is refused to remote clients; the topic monitor surfaces that
refusal rather than sitting silently empty.

### Last-hour charts

The charts backfill from `/api/v1/stats/history` and `/api/v1/metrics/history`,
which only answer when the HTTP API plugin has a `storage` backend configured:

```toml
storage.type = "redb"
storage.redb.path = "/var/log/rmqtt/.cache/http-api-history/{node}.redb"
```

Without it nothing breaks — the dashboard charts what it observes while open and
says so, on both the Overview and the Settings page.

## Configuration

All settings are read from the environment **at runtime**, so one build can be
pointed at any cluster. See [`.env.example`](.env.example).

| Variable                   | Default                 | Purpose                                        |
| -------------------------- | ----------------------- | ---------------------------------------------- |
| `RMQTT_API_URL`            | `http://127.0.0.1:6060` | HTTP API base, without `/api/v1`               |
| `RMQTT_API_TOKEN`          | _(empty)_               | Matches `http_bearer_token`; stays server-side |
| `RMQTT_API_TIMEOUT_MS`     | `10000`                 | Per-request timeout                            |
| `RMQTT_MQTT_URL`           | `mqtt://127.0.0.1:1883` | MQTT endpoint; empty disables live streaming   |
| `RMQTT_MQTT_USERNAME`      | `dashboard`             | See the ACL note above                         |
| `RMQTT_MQTT_PASSWORD`      | _(empty)_               |                                                |
| `RMQTT_MQTT_CLIENT_ID`     | _(random)_              |                                                |
| `RMQTT_MONITOR_RATE_LIMIT` | `500`                   | Max messages/second relayed to one browser tab |

## How it works

```
browser ──/api/rmqtt/*──▶ SvelteKit server ──▶ rmqtt HTTP API  (:6060)
        ──/api/stream───▶                  ──▶ rmqtt MQTT      (:1883)
             (SSE)            one shared MQTT connection
```

**The browser never talks to the broker directly.** Two things make that the
right call rather than an extra hop:

- The HTTP API sends no CORS headers and the bearer token must not reach the
  client, so `/api/rmqtt/*` proxies to it with the token attached server-side.
- `$SYS` is normally reachable only from the broker's own host. Holding the MQTT
  connection on the dashboard server means it works when co-located, keeps
  credentials out of the bundle, and — because topic filters are
  reference-counted across sessions — the broker sees **one** subscriber no
  matter how many dashboards are open.

### Where each number comes from

The two data sources do different jobs, and the split is deliberate:

- **HTTP polling** (default every 5s) is the only thing appended to the rolling
  sample buffer behind the charts. Rates such as _incoming messages/s_ are
  derived from deltas between cumulative counters, and deriving those from
  irregularly spaced reads invents spikes that are not in the data.
- **`$SYS` over MQTT** carries the push half: per-node stats and metrics as the
  broker publishes them (every `publish_interval`, 1 minute by default), plus
  the connect/disconnect/subscribe/session event feed, which has no HTTP
  equivalent at all.

Cluster totals are summed client-side from a single `/api/v1/stats` snapshot
rather than read from `/stats/sum`, so the per-node rows on the Nodes page can
never disagree with the totals on the Overview.

### Clearing a retained message

rmqtt exposes no delete endpoint for retained messages. **Clear** does the
MQTT-native thing: it publishes a zero-length payload to the same topic with the
retain flag set, which the broker treats as a removal. Subscribers see no new
message; the stored value simply stops being replayed.

### Broker clock calibration

The API formats timestamps as `YYYY-MM-DD HH:mm:ss` with no timezone, in
whatever zone the broker runs in — UTC in the stock container, local time on a
bare-metal install. Rather than guess, the dashboard reads `datetime` from
`/api/v1/brokers` (the broker's own current time, same format), measures the
offset against the browser clock, and corrects every relative time by it. The
measured offset is shown on the Settings page.

## Notes on the API

Verified against **rmqtt 0.23.1**, which differs from `docs/en_US/http-api.md`
in a few places the code accounts for:

- `/api/v1/stats` reports `retaineds.count`, not the documented `retained.count`
  (both keys are accepted).
- `/api/v1/subscriptions` returns an `opts` object — `opts.qos`, `opts.group` —
  rather than flat `qos` and `share` fields (both shapes are read).
- `/api/v1/plugins` returns `[{ node, plugins: [...] }]`, not a flat array.
- `/api/v1/retains` items may omit `msg_id` and `remaining_ttl`.
- 404s come back as an HTML error page, not JSON.

## Accessibility and design

Chart colours come from a validated categorical palette, checked against both
light (`#ffffff`) and dark (`#171d24`) chart surfaces for lightness band, chroma
floor, colour-vision-deficiency separation and contrast. Three light-mode hues
sit below 3:1 against the surface, so every chart carries the required relief:
a legend, direct end labels, a crosshair tooltip, and a full table view one
toggle away. Charts are keyboard-navigable with a live-region readout.

## Scripts

```bash
npm run dev      # dev server
npm run build    # production build (adapter-node, output in ./build)
npm run preview  # serve the production build
npm run check    # svelte-check + TypeScript
npm run format   # prettier

node scripts/dev-traffic.mjs   # fake MQTT traffic, so there is something to look at
```

## Project layout

```
src/
  lib/
    api/client.ts          typed browser client for /api/rmqtt/*
    server/config.ts       runtime environment
    server/proxy.ts        HTTP API relay
    server/mqtt.ts         shared MQTT bridge, ref-counted subscriptions
    stores/cluster.svelte.ts   polling, rolling history, $SYS ingestion
    stores/stream.svelte.ts    SSE client for live topics
    stores/brokerClock.svelte.ts   timezone calibration
    components/            charts, tables, dialogs, shell
  routes/
    api/rmqtt/[...path]    HTTP API proxy
    api/stream             server-sent events for live MQTT
    api/runtime-config     non-secret config for the browser
```

## Licence

[MIT](LICENSE) © 2026 Bizmate.

This project only talks to [RMQTT](https://github.com/rmqtt/rmqtt) over its
HTTP API and MQTT; it bundles no rmqtt code. rmqtt itself is offered under
MIT OR Apache-2.0.
