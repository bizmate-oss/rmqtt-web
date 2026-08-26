<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { api, errorText, fetchRuntimeConfig, type RuntimeConfig } from '$lib/api/client';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { Resource } from '$lib/stores/resource.svelte';
	import { cluster } from '$lib/stores/cluster.svelte';
	import { setPageMeta } from '$lib/stores/pageMeta.svelte';
	import { REFRESH_OPTIONS, settings, type ThemeChoice } from '$lib/stores/settings.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { brokerClock } from '$lib/stores/brokerClock.svelte';
	import { relative, uptime } from '$lib/utils/format';
	import type { NodePlugins, PayloadFormat } from '$lib/types';

	setPageMeta('Settings', 'Dashboard preferences and broker connection status');

	let runtime = $state<RuntimeConfig | null>(null);
	let runtimeError = $state<string | null>(null);

	const plugins = new Resource<NodePlugins[]>((signal) => api.plugins(signal));

	onMount(() => {
		fetchRuntimeConfig()
			.then((cfg) => (runtime = cfg))
			.catch((err) => (runtimeError = errorText(err)));
		plugins.start(30_000);
	});
	onDestroy(() => plugins.stop());

	const THEMES: Array<{ value: ThemeChoice; label: string; icon: 'system' | 'sun' | 'moon' }> = [
		{ value: 'system', label: 'System', icon: 'system' },
		{ value: 'light', label: 'Light', icon: 'sun' },
		{ value: 'dark', label: 'Dark', icon: 'moon' }
	];

	const FORMATS: PayloadFormat[] = ['auto', 'json', 'text', 'hex', 'base64'];

	/** Plugins whose absence changes what the dashboard can show. */
	const REQUIRED = {
		'rmqtt-http-api': 'Everything — the dashboard reads the cluster through it.',
		'rmqtt-sys-topic': 'The $SYS live feed: node stats/metrics pushes and the activity feed.',
		'rmqtt-retainer': 'The retained messages page.'
	} as const;

	const pluginRows = $derived.by(() => {
		const first = plugins.data?.[0];
		if (!first) return [];
		return [...first.plugins].sort((a, b) => {
			if (a.active !== b.active) return a.active ? -1 : 1;
			return a.name.localeCompare(b.name);
		});
	});

	const missing = $derived(
		Object.keys(REQUIRED).filter((name) => {
			const row = pluginRows.find((p) => p.name === name);
			return pluginRows.length > 0 && (!row || !row.active);
		}) as Array<keyof typeof REQUIRED>
	);

	const clockSkewMinutes = $derived(Math.round(brokerClock.offsetMs / 60_000));

	const SYS_TONE = {
		connected: 'good',
		connecting: 'warning',
		reconnecting: 'warning',
		error: 'critical',
		disabled: 'neutral'
	} as const;
</script>

<div class="flex flex-col gap-4">
	<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
		<!-- Dashboard preferences -->
		<section class="card p-4">
			<h2 class="text-sm font-semibold text-[var(--text)]">Dashboard</h2>
			<p class="mt-0.5 mb-4 text-[11px] text-[var(--text-muted)]">
				Stored in this browser only; nothing here reaches the broker.
			</p>

			<div class="flex flex-col gap-4">
				<div>
					<span class="label">Theme</span>
					<div class="flex gap-1.5">
						{#each THEMES as theme (theme.value)}
							<button
								type="button"
								class="btn {settings.current.theme === theme.value ? 'btn-primary' : 'btn-ghost'}"
								aria-pressed={settings.current.theme === theme.value}
								onclick={() => settings.set('theme', theme.value)}
							>
								<Icon name={theme.icon} size={13} />
								{theme.label}
							</button>
						{/each}
					</div>
				</div>

				<div>
					<label class="label" for="s-refresh">Refresh interval</label>
					<select
						id="s-refresh"
						class="input max-w-40"
						value={settings.current.refreshMs}
						onchange={(e) => settings.set('refreshMs', Number(e.currentTarget.value))}
					>
						{#each REFRESH_OPTIONS as opt (opt.value)}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
					<p class="mt-1 text-[11px] text-[var(--text-muted)]">
						How often the HTTP API is re-read. Charts sample at this cadence, so a slower interval
						means a coarser last-hour curve. The $SYS feed pushes regardless.
					</p>
				</div>

				<div>
					<label class="label" for="s-page">Rows per request</label>
					<input
						id="s-page"
						type="number"
						class="input max-w-40"
						min="10"
						max="10000"
						step="10"
						value={settings.current.pageSize}
						onchange={(e) =>
							settings.set('pageSize', Math.max(10, Number(e.currentTarget.value) || 200))}
					/>
					<p class="mt-1 text-[11px] text-[var(--text-muted)]">
						Sent as <code class="mono">_limit</code>. The broker caps it at its own
						<code class="mono">max_row_limit</code> (10,000 by default).
					</p>
				</div>

				<div>
					<label class="label" for="s-buffer">Topic monitor buffer</label>
					<input
						id="s-buffer"
						type="number"
						class="input max-w-40"
						min="50"
						max="20000"
						step="50"
						value={settings.current.monitorBuffer}
						onchange={(e) =>
							settings.set('monitorBuffer', Math.max(50, Number(e.currentTarget.value) || 1000))}
					/>
					<p class="mt-1 text-[11px] text-[var(--text-muted)]">
						Messages held in memory before the oldest are dropped.
					</p>
				</div>

				<div>
					<span class="label">Default payload format</span>
					<div class="flex flex-wrap gap-1.5">
						{#each FORMATS as fmt (fmt)}
							<button
								type="button"
								class="btn btn-sm {settings.current.payloadFormat === fmt
									? 'btn-primary'
									: 'btn-ghost'}"
								aria-pressed={settings.current.payloadFormat === fmt}
								onclick={() => settings.set('payloadFormat', fmt)}
							>
								{fmt}
							</button>
						{/each}
					</div>
					<p class="mt-1 text-[11px] text-[var(--text-muted)]">
						<strong>auto</strong> tries JSON, then printable text, then a hex dump.
					</p>
				</div>

				<div>
					<button
						type="button"
						class="btn btn-ghost"
						onclick={() => {
							settings.reset();
							toasts.success('Settings reset');
						}}
					>
						<Icon name="refresh" size={13} /> Reset to defaults
					</button>
				</div>
			</div>
		</section>

		<!-- Connection -->
		<section class="card p-4">
			<h2 class="text-sm font-semibold text-[var(--text)]">Broker connection</h2>
			<p class="mt-0.5 mb-4 text-[11px] text-[var(--text-muted)]">
				Configured on the dashboard server via environment variables — see
				<code class="mono">.env.example</code>. Restart the server to change them.
			</p>

			{#if runtimeError}
				<ErrorBanner message={runtimeError} />
			{:else if runtime}
				<dl class="flex flex-col gap-3">
					<div>
						<dt class="text-[10px] tracking-wide text-[var(--text-muted)] uppercase">
							HTTP API (RMQTT_API_URL)
						</dt>
						<dd class="mono flex flex-wrap items-center gap-2 text-[var(--text)]">
							{runtime.apiUrl}
							<StatusChip
								tone={cluster.error ? 'critical' : cluster.loadedAt ? 'good' : 'warning'}
								label={cluster.error
									? 'Unreachable'
									: cluster.loadedAt
										? 'Reachable'
										: 'Connecting'}
							/>
						</dd>
					</div>

					<div>
						<dt class="text-[10px] tracking-wide text-[var(--text-muted)] uppercase">
							Bearer token
						</dt>
						<dd class="text-xs text-[var(--text)]">
							{runtime.apiTokenConfigured
								? 'Configured — held on the server and never sent to the browser.'
								: 'Not configured (the broker has no http_bearer_token set).'}
						</dd>
					</div>

					<div>
						<dt class="text-[10px] tracking-wide text-[var(--text-muted)] uppercase">
							MQTT bridge (RMQTT_MQTT_URL)
						</dt>
						<dd class="mono flex flex-wrap items-center gap-2 text-[var(--text)]">
							{runtime.mqttConfigured ? runtime.mqttUrl : 'disabled'}
							<StatusChip tone={SYS_TONE[cluster.sysStatus]} label={cluster.sysStatus} />
						</dd>
						{#if cluster.sysDetail}
							<dd class="mt-0.5 text-[11px]" style="color:var(--critical-ink)">
								{cluster.sysDetail}
							</dd>
						{/if}
						{#if cluster.bridgeClientId}
							<dd class="mono mt-0.5 text-[var(--text-muted)]">
								client id {cluster.bridgeClientId}
							</dd>
						{/if}
					</div>

					<div>
						<dt class="text-[10px] tracking-wide text-[var(--text-muted)] uppercase">$SYS feed</dt>
						<dd class="text-xs text-[var(--text)]">
							{#if cluster.lastSysAt}
								Last publication {relative(cluster.lastSysAt)} · {cluster.sysEvents.length} events buffered
							{:else}
								No $SYS publication received yet. The broker publishes stats every
								<code class="mono">publish_interval</code> (1 minute by default).
							{/if}
						</dd>
					</div>

					<div>
						<dt class="text-[10px] tracking-wide text-[var(--text-muted)] uppercase">
							Clock offset
						</dt>
						<dd class="text-xs text-[var(--text)]">
							{#if !brokerClock.synced}
								Not calibrated yet.
							{:else if clockSkewMinutes === 0}
								The broker reports timestamps in this browser’s timezone; no correction needed.
							{:else}
								Broker timestamps run {clockSkewMinutes > 0 ? '+' : ''}{clockSkewMinutes} min from this
								browser (it most likely runs in UTC). Relative times shown across the dashboard are corrected
								by that amount.
							{/if}
						</dd>
					</div>

					<div>
						<dt class="text-[10px] tracking-wide text-[var(--text-muted)] uppercase">
							History storage
						</dt>
						<dd class="text-xs text-[var(--text)]">
							{#if cluster.historyAvailable === true}
								Available — last-hour charts are backfilled from
								<code class="mono">/api/v1/stats/history</code>.
							{:else if cluster.historyAvailable === false}
								Not configured. Charts show only what this tab has observed since it opened. Add a
								<code class="mono">storage</code> section to
								<code class="mono">plugins/rmqtt-http-api.toml</code> to enable backfill.
							{:else}
								Checking…
							{/if}
						</dd>
					</div>
				</dl>
			{:else}
				<p class="text-xs text-[var(--text-muted)]">Reading configuration…</p>
			{/if}
		</section>
	</div>

	<!-- Broker build info -->
	<section class="card overflow-hidden">
		<header class="border-b border-[var(--border)] px-4 py-3">
			<h2 class="text-sm font-semibold text-[var(--text)]">Broker</h2>
		</header>
		<div class="overflow-x-auto">
			<table class="tbl">
				<caption class="sr-only">Broker build and uptime per node</caption>
				<thead>
					<tr>
						<th scope="col">Node</th>
						<th scope="col">Status</th>
						<th scope="col">Version</th>
						<th scope="col">rustc</th>
						<th scope="col">Uptime</th>
						<th scope="col">Broker time</th>
						<th scope="col">Description</th>
					</tr>
				</thead>
				<tbody>
					{#each cluster.brokers as broker (broker.node_id)}
						<tr>
							<td class="mono text-[var(--text)]">{broker.node_name}</td>
							<td>
								<StatusChip
									tone={broker.running ? 'good' : 'critical'}
									label={broker.running ? 'Running' : 'Down'}
								/>
							</td>
							<td class="mono">{broker.version ?? '—'}</td>
							<td class="mono">{broker.rustc_version ?? '—'}</td>
							<td class="tabular-nums">{uptime(broker.uptime)}</td>
							<td class="mono tabular-nums">{broker.datetime ?? '—'}</td>
							<td>{broker.sysdescr ?? '—'}</td>
						</tr>
					{:else}
						<tr>
							<td colspan="7" class="px-4 py-8 text-center text-xs text-[var(--text-muted)]">
								Reading broker information…
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<!-- Plugins -->
	<section class="card overflow-hidden">
		<header
			class="flex flex-wrap items-start justify-between gap-2 border-b border-[var(--border)] px-4 py-3"
		>
			<div>
				<h2 class="text-sm font-semibold text-[var(--text)]">Plugins</h2>
				<p class="mt-0.5 text-[11px] text-[var(--text-muted)]">
					Reported for node {plugins.data?.[0]?.node ?? '—'}
				</p>
			</div>
		</header>

		{#if missing.length > 0}
			<div
				class="flex items-start gap-2.5 border-b border-[var(--border)] px-4 py-3"
				style="background:var(--warning-soft)"
			>
				<span style="color:var(--warning-ink)" class="mt-0.5 shrink-0">
					<Icon name="warning" size={15} />
				</span>
				<div class="text-xs text-[var(--text-2)]">
					<p class="font-medium" style="color:var(--warning-ink)">
						{missing.length} plugin{missing.length === 1 ? ' is' : 's are'} inactive
					</p>
					<ul class="mt-1 flex flex-col gap-0.5">
						{#each missing as name (name)}
							<li><code class="mono">{name}</code> — {REQUIRED[name]}</li>
						{/each}
					</ul>
					<p class="mt-1.5">
						Enable one for the current run with
						<code class="mono">PUT /api/v1/plugins/{'{node}'}/{'{plugin}'}/load</code>, or
						permanently in <code class="mono">rmqtt.toml</code> under
						<code class="mono">plugins.default_startups</code>.
					</p>
				</div>
			</div>
		{/if}

		<div class="max-h-96 overflow-y-auto">
			<table class="tbl">
				<caption class="sr-only">Plugin activation state</caption>
				<thead>
					<tr>
						<th scope="col">Plugin</th>
						<th scope="col">State</th>
						<th scope="col">Version</th>
						<th scope="col">Description</th>
					</tr>
				</thead>
				<tbody>
					{#each pluginRows as plugin (plugin.name)}
						<tr>
							<td class="mono text-[var(--text)]">{plugin.name}</td>
							<td>
								<StatusChip
									tone={plugin.active ? 'good' : 'neutral'}
									label={plugin.active ? 'Active' : 'Inactive'}
								/>
							</td>
							<td class="mono">{plugin.version ?? '—'}</td>
							<td class="max-w-[36rem] text-[var(--text-muted)]">{plugin.descr ?? '—'}</td>
						</tr>
					{:else}
						<tr>
							<td colspan="4" class="px-4 py-8 text-center text-xs text-[var(--text-muted)]">
								{plugins.error ?? 'Reading plugins…'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>
