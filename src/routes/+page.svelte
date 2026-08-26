<script lang="ts">
	import ChartCard from '$lib/components/ChartCard.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Meter from '$lib/components/Meter.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import SysEventFeed from '$lib/components/SysEventFeed.svelte';
	import { cluster, WINDOW_MS } from '$lib/stores/cluster.svelte';
	import { setPageMeta } from '$lib/stores/pageMeta.svelte';
	import { bytes, compact, hhmm, rate, uptime } from '$lib/utils/format';
	import type { Series } from '$lib/types';

	setPageMeta('Overview', 'Cluster health at a glance');

	/* The window ends at the most recent poll and starts at the oldest sample we
	   hold, so a dashboard opened two minutes ago plots two minutes rather than
	   58 minutes of blank canvas. */
	const to = $derived(cluster.loadedAt || Date.now());
	const from = $derived(cluster.windowStart || to - WINDOW_MS);

	const windowNote = $derived(
		cluster.historyAvailable
			? 'Last hour'
			: cluster.sampleCount > 1
				? `Collected since ${hhmm(from)}`
				: 'Collecting…'
	);

	const incoming = $derived(cluster.rateSeries('messages.publish'));
	const delivered = $derived(cluster.rateSeries('messages.delivered'));
	const dropped = $derived(cluster.rateSeries('messages.dropped'));
	const nonsubscribed = $derived(cluster.rateSeries('messages.nonsubscribed'));

	const throughput: Series[] = $derived([
		{ key: 'in', label: 'Incoming', color: 'var(--series-1)', points: incoming },
		{ key: 'out', label: 'Delivered', color: 'var(--series-2)', points: delivered }
	]);

	const connectionSeries: Series[] = $derived([
		{
			key: 'connections',
			label: 'Connections',
			color: 'var(--series-1)',
			points: cluster.statSeries('connections.count')
		},
		{
			key: 'sessions',
			label: 'Sessions',
			color: 'var(--series-2)',
			points: cluster.statSeries('sessions.count')
		}
	]);

	const routingSeries: Series[] = $derived([
		{
			key: 'subscriptions',
			label: 'Subscriptions',
			color: 'var(--series-1)',
			points: cluster.statSeries('subscriptions.count')
		},
		{
			key: 'topics',
			label: 'Topics',
			color: 'var(--series-2)',
			points: cluster.statSeries('topics.count')
		},
		{
			key: 'shared',
			label: 'Shared subs',
			color: 'var(--series-3)',
			points: cluster.statSeries('subscriptions_shared.count')
		}
	]);

	const lossSeries: Series[] = $derived([
		{ key: 'dropped', label: 'Dropped', color: 'var(--series-8)', points: dropped },
		{
			key: 'nonsubscribed',
			label: 'No subscriber',
			color: 'var(--series-4)',
			points: nonsubscribed
		}
	]);

	const perSecond = (v: number) => rate(v);
	const whole = (v: number) => compact(Math.round(v));
</script>

<div class="flex flex-col gap-5">
	{#if cluster.error}
		<ErrorBanner message={cluster.error} onretry={() => cluster.refresh()} />
	{/if}

	<!-- Key metrics. Each tile carries its last value and a last-hour trend. -->
	<section class="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
		<StatCard
			label="Nodes in cluster"
			value={compact(cluster.nodes.length)}
			icon="nodes"
			href="/nodes"
			footnote={cluster.nodes.length
				? `${cluster.runningNodes} running · ${cluster.nodes.length - cluster.runningNodes} down`
				: 'Waiting for the broker'}
			loading={cluster.loading && cluster.nodes.length === 0}
		/>
		<StatCard
			label="Incoming messages"
			value={rate(cluster.rateNow('messages.publish'))}
			unit="msg/s"
			icon="overview"
			trend={incoming}
			color="var(--series-1)"
			footnote="PUBLISH packets received · {windowNote.toLowerCase()}"
		/>
		<StatCard
			label="Connected clients"
			value={compact(cluster.stat('connections.count'))}
			icon="clients"
			href="/clients"
			trend={cluster.statSeries('connections.count')}
			color="var(--series-2)"
			footnote="{compact(cluster.stat('sessions.count'))} sessions incl. offline"
		/>
		<StatCard
			label="Topics"
			value={compact(cluster.stat('topics.count'))}
			icon="topics"
			href="/subscriptions"
			trend={cluster.statSeries('topics.count')}
			color="var(--series-3)"
			footnote="subscription filters in the routing table"
		/>
		<StatCard
			label="Subscriptions"
			value={compact(cluster.stat('subscriptions.count'))}
			icon="subscriptions"
			href="/subscriptions"
			trend={cluster.statSeries('subscriptions.count')}
			color="var(--series-4)"
			footnote="{compact(cluster.stat('subscriptions_shared.count'))} shared"
		/>
	</section>

	<!-- Last-hour charts -->
	<section class="grid grid-cols-1 gap-4 xl:grid-cols-2">
		<ChartCard
			title="Message throughput"
			subtitle="{windowNote} · messages per second, derived from the cumulative counters"
			series={throughput}
			format={perSecond}
			{from}
			{to}
			emptyMessage="Collecting the first samples…"
		/>
		<ChartCard
			title="Connections and sessions"
			subtitle={windowNote}
			series={connectionSeries}
			format={whole}
			{from}
			{to}
			emptyMessage="Collecting the first samples…"
		/>
		<ChartCard
			title="Topics and subscriptions"
			subtitle={windowNote}
			series={routingSeries}
			format={whole}
			{from}
			{to}
			emptyMessage="Collecting the first samples…"
		/>
		<ChartCard
			title="Dropped and undelivered"
			subtitle="{windowNote} · messages per second"
			series={lossSeries}
			format={perSecond}
			{from}
			{to}
			emptyMessage="Collecting the first samples…"
		/>
	</section>

	<div class="grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
		<!-- Cluster nodes strip -->
		<section class="card flex flex-col">
			<header
				class="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3"
			>
				<div>
					<h2 class="text-sm font-semibold text-[var(--text)]">Cluster nodes</h2>
					<p class="mt-0.5 text-[11px] text-[var(--text-muted)]">
						Whole-machine resources from <code class="mono">/api/v1/nodes</code>, not the broker
						process
					</p>
				</div>
				<a href="/nodes" class="btn btn-ghost btn-sm">
					All nodes <Icon name="chevronRight" size={13} />
				</a>
			</header>

			<!-- Dividers are drawn as cell borders rather than as gaps over a tinted
			     container: this card stretches to match the activity feed beside it,
			     and a tinted container would show through the unfilled space. -->
			<div class="grid grid-cols-1 sm:grid-cols-2">
				{#each cluster.nodes as node (node.node_id)}
					<a
						href="/nodes/{node.node_id}"
						class="flex flex-col gap-2.5 border-b border-[var(--border)] p-4 transition-colors hover:bg-[var(--surface-2)] sm:odd:border-r"
					>
						<div class="flex items-center justify-between gap-2">
							<span class="mono truncate font-semibold text-[var(--text)]">{node.node_name}</span>
							<StatusChip
								tone={node.running ? 'good' : 'critical'}
								label={node.running ? 'Running' : 'Down'}
							/>
						</div>

						<div class="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
							<div class="flex justify-between gap-2">
								<span class="text-[var(--text-muted)]">Clients</span>
								<span class="font-medium text-[var(--text)] tabular-nums">
									{compact(node.connections)}
								</span>
							</div>
							<div class="flex justify-between gap-2">
								<span class="text-[var(--text-muted)]">Uptime</span>
								<span class="font-medium text-[var(--text)] tabular-nums">
									{uptime(node.uptime)}
								</span>
							</div>
							<div class="flex justify-between gap-2">
								<span class="text-[var(--text-muted)]">Host load 1m</span>
								<span class="font-medium text-[var(--text)] tabular-nums">
									{node.load1?.toFixed(2) ?? '—'}
								</span>
							</div>
							<div class="flex justify-between gap-2">
								<span class="text-[var(--text-muted)]">Version</span>
								<span class="truncate font-medium text-[var(--text)]">{node.version}</span>
							</div>
						</div>

						<div class="flex flex-col gap-1.5">
							<div class="flex items-center gap-2">
								<span class="w-14 shrink-0 text-[10px] text-[var(--text-muted)]">Host mem</span>
								<Meter
									value={node.memory_used}
									max={node.memory_total}
									label="host memory used on {node.node_name}"
								/>
								<span
									class="w-20 shrink-0 text-right text-[10px] text-[var(--text-muted)] tabular-nums"
								>
									{bytes(node.memory_used)}
								</span>
							</div>
							<div class="flex items-center gap-2">
								<span class="w-14 shrink-0 text-[10px] text-[var(--text-muted)]">Host disk</span>
								<Meter
									value={node.disk_total - node.disk_free}
									max={node.disk_total}
									label="host disk used on {node.node_name}"
								/>
								<span
									class="w-20 shrink-0 text-right text-[10px] text-[var(--text-muted)] tabular-nums"
								>
									{bytes(node.disk_total - node.disk_free)}
								</span>
							</div>
						</div>
					</a>
				{:else}
					<div class="col-span-full px-4 py-10 text-center text-xs text-[var(--text-muted)]">
						{cluster.loading ? 'Reading the cluster…' : 'No nodes reported.'}
					</div>
				{/each}
			</div>
		</section>

		<SysEventFeed limit={30} />
	</div>
</div>
