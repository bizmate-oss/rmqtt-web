<script lang="ts">
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Meter from '$lib/components/Meter.svelte';
	import SortHeader from '$lib/components/SortHeader.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { cluster, readStat, type StatKey } from '$lib/stores/cluster.svelte';
	import { setPageMeta } from '$lib/stores/pageMeta.svelte';
	import { bytes, compact, uptime } from '$lib/utils/format';
	import { download, timestampedName, toCsv } from '$lib/utils/download';
	import { toasts } from '$lib/stores/toasts.svelte';
	import type { NodeInfo } from '$lib/types';

	setPageMeta('Nodes', 'Per-node health and workload across the cluster');

	type Column =
		| 'node_id'
		| 'node_name'
		| 'running'
		| 'connections'
		| 'sessions'
		| 'subscriptions'
		| 'published'
		| 'memory'
		| 'disk'
		| 'load1'
		| 'uptime';

	let sortBy = $state<Column>('node_id');
	let direction = $state<'asc' | 'desc'>('asc');

	function onsort(column: Column) {
		if (sortBy === column) {
			direction = direction === 'asc' ? 'desc' : 'asc';
		} else {
			sortBy = column;
			direction = column === 'node_id' || column === 'node_name' ? 'asc' : 'desc';
		}
	}

	/** Per-node maps, taken from the same snapshot as the node list. */
	const statsById = $derived(new Map(cluster.nodeStats.map((s) => [s.node.id, s.stats] as const)));
	const metricsById = $derived(
		new Map(cluster.nodeMetrics.map((m) => [m.node.id, m.metrics] as const))
	);

	function nodeStat(node: NodeInfo, key: StatKey): number {
		return readStat(statsById.get(node.node_id), key) ?? 0;
	}

	function published(node: NodeInfo): number {
		return metricsById.get(node.node_id)?.['messages.publish'] ?? 0;
	}

	function sortValue(node: NodeInfo, column: Column): number | string {
		switch (column) {
			case 'node_id':
				return node.node_id;
			case 'node_name':
				return node.node_name;
			case 'running':
				return node.running ? 1 : 0;
			case 'connections':
				return node.connections;
			case 'sessions':
				return nodeStat(node, 'sessions.count');
			case 'subscriptions':
				return nodeStat(node, 'subscriptions.count');
			case 'published':
				return published(node);
			case 'memory':
				return node.memory_total ? node.memory_used / node.memory_total : 0;
			case 'disk':
				return node.disk_total ? (node.disk_total - node.disk_free) / node.disk_total : 0;
			case 'load1':
				return node.load1 ?? 0;
			case 'uptime':
				return node.uptime ?? '';
		}
	}

	const rows = $derived(
		[...cluster.nodes].sort((a, b) => {
			const va = sortValue(a, sortBy);
			const vb = sortValue(b, sortBy);
			const cmp =
				typeof va === 'string' || typeof vb === 'string'
					? String(va).localeCompare(String(vb))
					: va - vb;
			return direction === 'asc' ? cmp : -cmp;
		})
	);

	function exportCsv() {
		const columns = [
			'node_id',
			'node_name',
			'running',
			'version',
			'uptime',
			'connections',
			'sessions',
			'subscriptions',
			'topics',
			'retained',
			'messages_publish',
			'messages_delivered',
			'memory_used',
			'memory_total',
			'disk_used',
			'disk_total',
			'load1',
			'load5',
			'load15'
		];
		const data = rows.map((n) => ({
			node_id: n.node_id,
			node_name: n.node_name,
			running: n.running,
			version: n.version,
			uptime: n.uptime,
			connections: n.connections,
			sessions: nodeStat(n, 'sessions.count'),
			subscriptions: nodeStat(n, 'subscriptions.count'),
			topics: nodeStat(n, 'topics.count'),
			retained: nodeStat(n, 'retained.count'),
			messages_publish: published(n),
			messages_delivered: metricsById.get(n.node_id)?.['messages.delivered'] ?? 0,
			memory_used: n.memory_used,
			memory_total: n.memory_total,
			disk_used: n.disk_total - n.disk_free,
			disk_total: n.disk_total,
			load1: n.load1,
			load5: n.load5,
			load15: n.load15
		}));
		download(timestampedName('rmqtt-nodes', 'csv'), toCsv(columns, data), 'text/csv;charset=utf-8');
		toasts.success('Exported', `${data.length} nodes written to CSV.`);
	}
</script>

<div class="flex flex-col gap-4">
	{#if cluster.error}
		<ErrorBanner message={cluster.error} onretry={() => cluster.refresh()} />
	{/if}

	<section class="card overflow-hidden">
		<header
			class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3"
		>
			<div>
				<h2 class="text-sm font-semibold text-[var(--text)]">
					{cluster.nodes.length} node{cluster.nodes.length === 1 ? '' : 's'}
				</h2>
				<p class="mt-0.5 text-[11px] text-[var(--text-muted)]">
					{cluster.runningNodes} running · {cluster.nodes.length - cluster.runningNodes} down
				</p>
			</div>
			<button
				type="button"
				class="btn btn-ghost btn-sm"
				onclick={exportCsv}
				disabled={rows.length === 0}
			>
				<Icon name="download" size={13} /> Export CSV
			</button>
		</header>

		<div class="overflow-x-auto" class:opacity-60={cluster.loading && rows.length === 0}>
			<table class="tbl">
				<caption class="sr-only">Cluster nodes with per-node resources and workload</caption>
				<thead>
					<tr>
						<SortHeader column="node_id" label="ID" active={sortBy} {direction} {onsort} />
						<SortHeader column="node_name" label="Node" active={sortBy} {direction} {onsort} />
						<SortHeader column="running" label="Status" active={sortBy} {direction} {onsort} />
						<SortHeader
							column="connections"
							label="Clients"
							align="right"
							active={sortBy}
							{direction}
							{onsort}
						/>
						<SortHeader
							column="sessions"
							label="Sessions"
							align="right"
							active={sortBy}
							{direction}
							{onsort}
						/>
						<SortHeader
							column="subscriptions"
							label="Subs"
							align="right"
							active={sortBy}
							{direction}
							{onsort}
						/>
						<SortHeader
							column="published"
							label="Msgs in"
							align="right"
							active={sortBy}
							{direction}
							{onsort}
						/>
						<SortHeader column="memory" label="Host memory" active={sortBy} {direction} {onsort} />
						<SortHeader column="disk" label="Host disk" active={sortBy} {direction} {onsort} />
						<SortHeader
							column="load1"
							label="Host load 1/5/15"
							align="right"
							active={sortBy}
							{direction}
							{onsort}
						/>
						<SortHeader column="uptime" label="Uptime" active={sortBy} {direction} {onsort} />
						<th scope="col">Version</th>
						<th scope="col" class="sticky-actions"><span class="sr-only">Details</span></th>
					</tr>
				</thead>
				<tbody>
					{#each rows as node (node.node_id)}
						{@const sys = cluster.sysNodes[node.node_id]}
						<tr>
							<td class="num">{node.node_id}</td>
							<td>
								<a
									href="/nodes/{node.node_id}"
									class="mono font-medium text-[var(--text)] hover:text-[var(--brand-ink)]"
								>
									{node.node_name}
								</a>
								{#if sys?.statsAt}
									<span
										class="ml-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
										style="background:var(--good)"
										title="Publishing to $SYS"
									></span>
								{/if}
							</td>
							<td>
								<StatusChip
									tone={node.running ? 'good' : 'critical'}
									label={node.running ? 'Running' : 'Down'}
								/>
							</td>
							<td class="num">{compact(node.connections)}</td>
							<td class="num">{compact(nodeStat(node, 'sessions.count'))}</td>
							<td class="num">{compact(nodeStat(node, 'subscriptions.count'))}</td>
							<td class="num">{compact(published(node))}</td>
							<td class="min-w-36">
								<Meter
									value={node.memory_used}
									max={node.memory_total}
									label="host memory used on {node.node_name}"
								/>
								<div class="mt-0.5 text-[10px] text-[var(--text-muted)] tabular-nums">
									{bytes(node.memory_used)} / {bytes(node.memory_total)}
								</div>
							</td>
							<td class="min-w-36">
								<Meter
									value={node.disk_total - node.disk_free}
									max={node.disk_total}
									label="host disk used on {node.node_name}"
								/>
								<div class="mt-0.5 text-[10px] text-[var(--text-muted)] tabular-nums">
									{bytes(node.disk_free)} free
								</div>
							</td>
							<td class="num whitespace-nowrap">
								{node.load1?.toFixed(2)} / {node.load5?.toFixed(2)} / {node.load15?.toFixed(2)}
							</td>
							<td class="whitespace-nowrap tabular-nums">{uptime(node.uptime)}</td>
							<td class="mono truncate-cell text-[var(--text-muted)]">{node.version}</td>
							<td class="sticky-actions text-right">
								<a href="/nodes/{node.node_id}" class="btn btn-ghost btn-sm">
									Details <Icon name="chevronRight" size={12} />
								</a>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="13" class="px-4 py-10 text-center text-xs text-[var(--text-muted)]">
								{cluster.loading ? 'Reading the cluster…' : 'The broker reported no nodes.'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<p class="text-[11px] text-[var(--text-muted)]">
		A green dot beside a node name means it is publishing to
		<code class="mono">$SYS/brokers/{'{node}'}/stats</code>. Counts come from
		<code class="mono">/api/v1/stats</code> and <code class="mono">/api/v1/metrics</code> read in
		the same snapshot as the node list, so these rows always add up to the cluster figures on the
		overview. <strong>Msgs in</strong> is the cumulative PUBLISH count since the node started, not a rate.
	</p>

	<p class="text-[11px] text-[var(--text-muted)]">
		Memory, disk and load are the <strong>whole machine's</strong>, taken from
		<code class="mono">/api/v1/nodes</code>
		— not the rmqtt process's. rmqtt exposes no per-process CPU or memory on any endpoint. Under a container
		runtime these figures come from the host the container sits on, so on Kubernetes they describe the
		node, not the pod: use <code class="mono">kubectl top pod</code> or your metrics stack for the broker's
		own usage.
	</p>
</div>
