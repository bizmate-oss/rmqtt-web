<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { page } from '$app/state';
	import { api } from '$lib/api/client';
	import ChartCard from '$lib/components/ChartCard.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Meter from '$lib/components/Meter.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { Resource } from '$lib/stores/resource.svelte';
	import { cluster, readStat, type StatKey } from '$lib/stores/cluster.svelte';
	import { setPageMeta } from '$lib/stores/pageMeta.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { bytes, compact, full, rate, relative, stamp, uptime } from '$lib/utils/format';
	import { gaugeSeries, rateSeries } from '$lib/utils/series';
	import type { HistorySum, Series } from '$lib/types';

	const nodeId = $derived(Number(page.params.id));
	const node = $derived(cluster.nodes.find((n) => n.node_id === nodeId));
	const stats = $derived(cluster.nodeStats.find((s) => s.node.id === nodeId)?.stats);
	const metrics = $derived(cluster.nodeMetrics.find((m) => m.node.id === nodeId)?.metrics);
	const sys = $derived(cluster.sysNodes[nodeId]);

	$effect(() => {
		setPageMeta(node ? node.node_name : `Node ${nodeId}`, 'Node detail');
	});

	/* Per-node charts read the history endpoints directly rather than keeping a
	   second rolling buffer: each response already carries the full last hour. */
	const statsHistory = new Resource<HistorySum>((signal) =>
		api.statsHistoryNode(nodeId, { hours: 1, limit: 720 }, signal)
	);
	const metricsHistory = new Resource<HistorySum>((signal) =>
		api.metricsHistoryNode(nodeId, { hours: 1, limit: 720 }, signal)
	);

	onMount(() => {
		statsHistory.start(Math.max(settings.current.refreshMs, 10_000));
		metricsHistory.start(Math.max(settings.current.refreshMs, 10_000));
	});
	onDestroy(() => {
		statsHistory.stop();
		metricsHistory.stop();
	});

	// Re-read whenever the route id changes (navigating between node pages).
	$effect(() => {
		void nodeId;
		void statsHistory.refresh();
		void metricsHistory.refresh();
	});

	const historyUnavailable = $derived(
		Boolean(statsHistory.error) || (statsHistory.hasData && (statsHistory.data?.count ?? 0) === 0)
	);

	const throughput: Series[] = $derived([
		{
			key: 'in',
			label: 'Incoming',
			color: 'var(--series-1)',
			points: rateSeries(metricsHistory.data, 'messages.publish')
		},
		{
			key: 'out',
			label: 'Delivered',
			color: 'var(--series-2)',
			points: rateSeries(metricsHistory.data, 'messages.delivered')
		}
	]);

	const connectionSeries: Series[] = $derived([
		{
			key: 'connections',
			label: 'Connections',
			color: 'var(--series-1)',
			points: gaugeSeries(statsHistory.data, 'connections.count')
		},
		{
			key: 'sessions',
			label: 'Sessions',
			color: 'var(--series-2)',
			points: gaugeSeries(statsHistory.data, 'sessions.count')
		}
	]);

	const routingSeries: Series[] = $derived([
		{
			key: 'subs',
			label: 'Subscriptions',
			color: 'var(--series-1)',
			points: gaugeSeries(statsHistory.data, 'subscriptions.count')
		},
		{
			key: 'topics',
			label: 'Topics',
			color: 'var(--series-2)',
			points: gaugeSeries(statsHistory.data, 'topics.count')
		},
		{
			key: 'retained',
			label: 'Retained',
			color: 'var(--series-3)',
			points: gaugeSeries(statsHistory.data, 'retained.count', ['retaineds.count'])
		}
	]);

	const from = $derived(statsHistory.data?.from);
	const to = $derived(statsHistory.data?.to);

	/** Every tracked gauge, for the counters grid. */
	const STAT_LABELS: Array<[StatKey, string]> = [
		['connections.count', 'Connections'],
		['sessions.count', 'Sessions'],
		['subscriptions.count', 'Subscriptions'],
		['subscriptions_shared.count', 'Shared subscriptions'],
		['topics.count', 'Topics'],
		['routes.count', 'Routes'],
		['retained.count', 'Retained messages'],
		['handshakings.count', 'Handshaking'],
		['in_inflights.count', 'Inflight in'],
		['out_inflights.count', 'Inflight out'],
		['message_queues.count', 'Queued messages']
	];

	/** Metrics grouped by their dotted prefix, so the table reads by subsystem. */
	const metricGroups = $derived.by(() => {
		const source = metrics ?? sys?.metrics ?? {};
		const groups = new Map<string, Array<[string, number]>>();
		for (const [key, value] of Object.entries(source)) {
			const group = key.split('.')[0];
			if (!groups.has(group)) groups.set(group, []);
			groups.get(group)!.push([key, value]);
		}
		for (const rows of groups.values()) rows.sort((a, b) => a[0].localeCompare(b[0]));
		return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	});
</script>

<div class="flex flex-col gap-4">
	<a
		href="/nodes"
		class="flex w-fit items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text)]"
	>
		<Icon name="chevronRight" size={12} class="rotate-180" /> All nodes
	</a>

	{#if !node}
		<div class="card px-4 py-10 text-center text-sm text-[var(--text-muted)]">
			{cluster.loading ? 'Reading the cluster…' : `The broker reports no node with id ${nodeId}.`}
		</div>
	{:else}
		<!-- Identity -->
		<section class="card flex flex-wrap items-start justify-between gap-4 p-4">
			<div class="min-w-0">
				<div class="flex flex-wrap items-center gap-2">
					<h2 class="mono text-base font-semibold text-[var(--text)]">{node.node_name}</h2>
					<StatusChip
						tone={node.running ? 'good' : 'critical'}
						label={node.running ? 'Running' : 'Down'}
					/>
				</div>
				<dl class="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[11px]">
					<div class="flex gap-1.5">
						<dt class="text-[var(--text-muted)]">Version</dt>
						<dd class="mono text-[var(--text)]">{node.version}</dd>
					</div>
					{#if node.rustc_version}
						<div class="flex gap-1.5">
							<dt class="text-[var(--text-muted)]">rustc</dt>
							<dd class="mono text-[var(--text)]">{node.rustc_version}</dd>
						</div>
					{/if}
					<div class="flex gap-1.5">
						<dt class="text-[var(--text-muted)]">Uptime</dt>
						<dd class="text-[var(--text)] tabular-nums">{uptime(node.uptime)}</dd>
					</div>
					<div class="flex gap-1.5">
						<dt class="text-[var(--text-muted)]">Booted</dt>
						<dd class="text-[var(--text)] tabular-nums">{node.boottime}</dd>
					</div>
					{#if sys?.statsAt}
						<div class="flex gap-1.5">
							<dt class="text-[var(--text-muted)]">Last $SYS</dt>
							<dd class="text-[var(--text)]">{relative(sys.statsAt)}</dd>
						</div>
					{/if}
				</dl>
			</div>

			<div class="flex flex-wrap gap-6">
				<div class="min-w-44">
					<div class="mb-1 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
						<Icon name="memory" size={12} /> Host memory
					</div>
					<Meter value={node.memory_used} max={node.memory_total} label="host memory" />
					<div class="mt-1 text-[11px] text-[var(--text-2)] tabular-nums">
						{bytes(node.memory_used)} used · {bytes(node.memory_free)} free
					</div>
				</div>
				<div class="min-w-44">
					<div class="mb-1 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
						<Icon name="disk" size={12} /> Host disk
					</div>
					<Meter value={node.disk_total - node.disk_free} max={node.disk_total} label="host disk" />
					<div class="mt-1 text-[11px] text-[var(--text-2)] tabular-nums">
						{bytes(node.disk_total - node.disk_free)} used · {bytes(node.disk_free)} free
					</div>
				</div>
				<div class="min-w-32">
					<div class="mb-1 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
						<Icon name="cpu" size={12} /> Host load average
					</div>
					<div class="flex gap-3 text-sm font-semibold text-[var(--text)] tabular-nums">
						<span title="1 minute">{node.load1?.toFixed(2)}</span>
						<span title="5 minutes" class="text-[var(--text-2)]">{node.load5?.toFixed(2)}</span>
						<span title="15 minutes" class="text-[var(--text-muted)]"
							>{node.load15?.toFixed(2)}</span
						>
					</div>
					<div class="mt-0.5 text-[10px] text-[var(--text-muted)]">1m · 5m · 15m</div>
				</div>
			</div>

			<p class="w-full border-t border-[var(--border)] pt-3 text-[11px] text-[var(--text-muted)]">
				<Icon name="info" size={11} class="inline align-[-1px]" />
				Memory, disk and load are the <strong>whole machine's</strong>, taken from
				<code class="mono">/api/v1/nodes</code>
				— not the rmqtt process's. rmqtt exposes no per-process CPU or memory on any endpoint. Under a
				container runtime these figures come from the host the container sits on, so on Kubernetes they
				describe the node, not the pod: use <code class="mono">kubectl top pod</code> or your metrics
				stack for the broker's own usage.
			</p>
		</section>

		<!-- Current gauges -->
		<section class="card p-4">
			<h2 class="mb-3 text-sm font-semibold text-[var(--text)]">Current counters</h2>
			<dl class="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
				{#each STAT_LABELS as [key, label] (key)}
					{@const value = readStat(stats ?? sys?.stats, key)}
					<div>
						<dt class="text-[11px] text-[var(--text-muted)]">{label}</dt>
						<dd class="text-lg font-semibold text-[var(--text)] tabular-nums">
							{value === undefined ? '—' : compact(value)}
						</dd>
					</div>
				{/each}
			</dl>
		</section>

		{#if statsHistory.error}
			<ErrorBanner
				message={statsHistory.error}
				onretry={() => {
					void statsHistory.refresh();
					void metricsHistory.refresh();
				}}
			/>
		{:else if historyUnavailable}
			<div
				class="flex items-start gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3.5 py-3 text-xs text-[var(--text-2)]"
			>
				<Icon name="info" size={14} class="mt-0.5 shrink-0 text-[var(--text-muted)]" />
				<p>
					No history for this node. The per-node charts need a
					<code class="mono">storage</code> backend in
					<code class="mono">plugins/rmqtt-http-api.toml</code>, which is what makes
					<code class="mono">/api/v1/stats/history</code> answer. The cluster overview keeps working without
					it — it charts what it observes while open.
				</p>
			</div>
		{:else}
			<section class="grid grid-cols-1 gap-4 xl:grid-cols-2">
				<ChartCard
					title="Message throughput"
					subtitle="Last hour on this node · messages per second"
					series={throughput}
					format={(v) => rate(v)}
					{from}
					{to}
					emptyMessage="No history for this node yet"
				/>
				<ChartCard
					title="Connections and sessions"
					subtitle="Last hour on this node"
					series={connectionSeries}
					format={(v) => compact(Math.round(v))}
					{from}
					{to}
					emptyMessage="No history for this node yet"
				/>
				<ChartCard
					title="Routing state"
					subtitle="Last hour on this node"
					series={routingSeries}
					format={(v) => compact(Math.round(v))}
					{from}
					{to}
					emptyMessage="No history for this node yet"
				/>
			</section>
		{/if}

		<!-- Full metrics -->
		<section class="card overflow-hidden">
			<header class="border-b border-[var(--border)] px-4 py-3">
				<h2 class="text-sm font-semibold text-[var(--text)]">All metrics</h2>
				<p class="mt-0.5 text-[11px] text-[var(--text-muted)]">
					Cumulative counters since the node started, from
					<code class="mono">/api/v1/metrics/{nodeId}</code>
					{#if !metrics && sys?.metricsAt}
						· falling back to the $SYS snapshot from {stamp(sys.metricsAt)}
					{/if}
				</p>
			</header>
			<div class="grid grid-cols-1 gap-px bg-[var(--border)] md:grid-cols-2 xl:grid-cols-3">
				{#each metricGroups as [group, rows] (group)}
					<div class="bg-[var(--surface)] p-4">
						<h3
							class="mb-2 text-[11px] font-semibold tracking-wide text-[var(--text-muted)] uppercase"
						>
							{group}
						</h3>
						<dl class="flex flex-col gap-1">
							{#each rows as [key, value] (key)}
								<div class="flex items-baseline justify-between gap-3">
									<dt class="mono truncate text-[var(--text-2)]" title={key}>
										{key.slice(group.length + 1) || key}
									</dt>
									<dd class="shrink-0 text-xs font-medium text-[var(--text)] tabular-nums">
										{full(value)}
									</dd>
								</div>
							{/each}
						</dl>
					</div>
				{:else}
					<div class="bg-[var(--surface)] px-4 py-10 text-center text-xs text-[var(--text-muted)]">
						No metrics reported for this node.
					</div>
				{/each}

				<!-- Pads an incomplete last row so the container colour, which draws
				     the dividers, never shows through as a bare block. -->
				{#each { length: (3 - (metricGroups.length % 3)) % 3 } as _, i (i)}
					<div class="hidden bg-[var(--surface)] xl:block"></div>
				{/each}
			</div>
		</section>
	{/if}
</div>
