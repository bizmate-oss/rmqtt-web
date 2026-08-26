<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { api } from '$lib/api/client';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import SortHeader from '$lib/components/SortHeader.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import { Resource } from '$lib/stores/resource.svelte';
	import { cluster } from '$lib/stores/cluster.svelte';
	import { setPageMeta } from '$lib/stores/pageMeta.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { bytes, compact, relative } from '$lib/utils/format';
	import { download, timestampedName, toCsv } from '$lib/utils/download';
	import { base64ToBytes } from '$lib/utils/payload';
	import {
		subQos,
		subShare,
		type RetainedPage,
		type RouteInfo,
		type SubscriptionInfo
	} from '$lib/types';

	setPageMeta('Topics', 'The cluster routing table, plus every topic holding retained state');

	let search = $state('');
	let kind = $state<'all' | 'exact' | 'wildcard'>('all');
	let source = $state<'all' | 'routed' | 'retained'>('all');

	let appliedSearch = $state('');
	$effect(() => {
		const next = search;
		const timer = setTimeout(() => (appliedSearch = next), 300);
		return () => clearTimeout(timer);
	});

	/* A topic is interesting for two independent reasons: it is in the routing
	   table (something subscribes to it), or it holds a retained message. Both
	   sources are read and merged so neither kind of topic is invisible here. */
	const routes = new Resource<RouteInfo[]>((signal) =>
		api.routes({ _limit: settings.current.pageSize }, signal)
	);
	const subs = new Resource<SubscriptionInfo[]>((signal) =>
		api.subscriptions({ _limit: settings.current.pageSize }, signal)
	);
	const retains = new Resource<RetainedPage>((signal) =>
		api.retains({ topic_filter: '#', offset: 0, limit: settings.current.pageSize }, signal)
	);

	onMount(() => {
		const every = settings.current.refreshMs;
		routes.start(every);
		subs.start(every);
		retains.start(Math.max(every, 10_000));
	});
	onDestroy(() => {
		routes.stop();
		subs.stop();
		retains.stop();
	});
	$effect(() => {
		const every = settings.current.refreshMs;
		routes.setInterval(every);
		subs.setInterval(every);
		retains.setInterval(Math.max(every, 10_000));
	});

	function refreshAll() {
		void routes.refresh();
		void subs.refresh();
		void retains.refresh();
	}

	const isWildcard = (t: string) => t.includes('+') || t.includes('#');

	interface TopicRow {
		topic: string;
		wildcard: boolean;
		routed: boolean;
		nodes: number[];
		subscribers: number;
		sessions: number;
		qos: [number, number, number];
		shares: string[];
		retainedBytes: number | null;
		retainedAt: number | null;
	}

	const rows = $derived.by(() => {
		const map = new Map<string, TopicRow>();
		const blank = (topic: string): TopicRow => ({
			topic,
			wildcard: isWildcard(topic),
			routed: false,
			nodes: [],
			subscribers: 0,
			sessions: 0,
			qos: [0, 0, 0],
			shares: [],
			retainedBytes: null,
			retainedAt: null
		});
		const get = (topic: string) => {
			let row = map.get(topic);
			if (!row) {
				row = blank(topic);
				map.set(topic, row);
			}
			return row;
		};

		for (const route of routes.data ?? []) {
			const row = get(route.topic);
			row.routed = true;
			if (!row.nodes.includes(route.node_id)) row.nodes.push(route.node_id);
		}

		const seenSessions = new Map<string, Set<string>>();
		for (const sub of subs.data ?? []) {
			const row = get(sub.topic);
			row.routed = true;
			row.subscribers++;
			if (!row.nodes.includes(sub.node_id)) row.nodes.push(sub.node_id);
			const q = subQos(sub);
			if (q >= 0 && q <= 2) row.qos[q]++;
			const group = subShare(sub);
			if (group && !row.shares.includes(group)) row.shares.push(group);
			if (!seenSessions.has(sub.topic)) seenSessions.set(sub.topic, new Set());
			seenSessions.get(sub.topic)!.add(sub.clientid);
		}
		for (const [topic, set] of seenSessions) get(topic).sessions = set.size;

		for (const item of retains.data?.items ?? []) {
			const row = get(item.topic);
			row.retainedBytes = base64ToBytes(item.publish.payload).byteLength;
			row.retainedAt = item.publish.create_time ?? null;
		}

		return [...map.values()];
	});

	const filtered = $derived(
		rows.filter((row) => {
			if (appliedSearch && !row.topic.toLowerCase().includes(appliedSearch.toLowerCase())) {
				return false;
			}
			if (kind === 'exact' && row.wildcard) return false;
			if (kind === 'wildcard' && !row.wildcard) return false;
			if (source === 'routed' && !row.routed) return false;
			if (source === 'retained' && row.retainedBytes === null) return false;
			return true;
		})
	);

	type Column = 'topic' | 'subscribers' | 'nodes' | 'retainedBytes';
	let sortBy = $state<Column>('subscribers');
	let direction = $state<'asc' | 'desc'>('desc');

	function onsort(column: Column) {
		if (sortBy === column) direction = direction === 'asc' ? 'desc' : 'asc';
		else {
			sortBy = column;
			direction = column === 'topic' ? 'asc' : 'desc';
		}
	}

	const sorted = $derived(
		[...filtered].sort((a, b) => {
			let cmp: number;
			if (sortBy === 'topic') cmp = a.topic.localeCompare(b.topic);
			else if (sortBy === 'nodes') cmp = a.nodes.length - b.nodes.length;
			else if (sortBy === 'retainedBytes') cmp = (a.retainedBytes ?? -1) - (b.retainedBytes ?? -1);
			else cmp = a.subscribers - b.subscribers;
			return direction === 'asc' ? cmp : -cmp;
		})
	);

	const summary = $derived({
		total: rows.length,
		routed: rows.filter((r) => r.routed).length,
		retained: rows.filter((r) => r.retainedBytes !== null).length,
		wildcard: rows.filter((r) => r.wildcard).length
	});

	const error = $derived(routes.error ?? subs.error ?? retains.error);

	function exportCsv() {
		const columns = [
			'topic',
			'kind',
			'routed',
			'nodes',
			'subscribers',
			'sessions',
			'qos0',
			'qos1',
			'qos2',
			'shared_groups',
			'retained_bytes'
		];
		const data = sorted.map((r) => ({
			topic: r.topic,
			kind: r.wildcard ? 'wildcard' : 'exact',
			routed: r.routed,
			nodes: r.nodes.join(' '),
			subscribers: r.subscribers,
			sessions: r.sessions,
			qos0: r.qos[0],
			qos1: r.qos[1],
			qos2: r.qos[2],
			shared_groups: r.shares.join(' '),
			retained_bytes: r.retainedBytes ?? ''
		}));
		download(
			timestampedName('rmqtt-topics', 'csv'),
			toCsv(columns, data),
			'text/csv;charset=utf-8'
		);
		toasts.success('Exported', `${data.length} topics written to CSV.`);
	}
</script>

<div class="flex flex-col gap-4">
	<section class="grid grid-cols-2 gap-4 lg:grid-cols-4">
		<StatCard
			label="Topics known"
			value={compact(summary.total)}
			icon="topics"
			footnote="routed filters and retained topics"
		/>
		<StatCard
			label="In the routing table"
			value={compact(summary.routed)}
			icon="subscriptions"
			footnote="{compact(cluster.stat('routes.count'))} routes reported by the broker"
		/>
		<StatCard
			label="Holding retained state"
			value={compact(summary.retained)}
			icon="retained"
			href="/retained"
		/>
		<StatCard label="Wildcard filters" value={compact(summary.wildcard)} icon="filter" />
	</section>

	<section class="card flex flex-wrap items-end gap-3 p-3">
		<div class="min-w-56 flex-1">
			<label class="label" for="t-search">Topic contains</label>
			<div class="relative">
				<span
					class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--text-muted)]"
				>
					<Icon name="search" size={13} />
				</span>
				<input
					id="t-search"
					class="input mono pl-8"
					placeholder="demo/"
					bind:value={search}
					autocomplete="off"
				/>
			</div>
		</div>
		<div class="min-w-32">
			<label class="label" for="t-kind">Kind</label>
			<select id="t-kind" class="input" bind:value={kind}>
				<option value="all">All</option>
				<option value="exact">Exact</option>
				<option value="wildcard">Wildcard</option>
			</select>
		</div>
		<div class="min-w-36">
			<label class="label" for="t-source">Source</label>
			<select id="t-source" class="input" bind:value={source}>
				<option value="all">Routed or retained</option>
				<option value="routed">Routed only</option>
				<option value="retained">Retained only</option>
			</select>
		</div>
		<a href="/topics/monitor" class="btn btn-primary">
			<Icon name="monitor" size={14} /> Open topic monitor
		</a>
	</section>

	{#if error}
		<ErrorBanner message={error} onretry={refreshAll} />
	{/if}

	<section class="card overflow-hidden">
		<header
			class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3"
		>
			<div>
				<h2 class="text-sm font-semibold text-[var(--text)]">
					{compact(sorted.length)} topic{sorted.length === 1 ? '' : 's'}
				</h2>
				<p class="mt-0.5 text-[11px] text-[var(--text-muted)]">
					{#if routes.loadedAt}Read {relative(routes.loadedAt)}{/if}
				</p>
			</div>
			<button
				type="button"
				class="btn btn-ghost btn-sm"
				onclick={exportCsv}
				disabled={sorted.length === 0}
			>
				<Icon name="download" size={13} /> Export CSV
			</button>
		</header>

		<div class="overflow-x-auto" class:opacity-60={routes.initialLoading}>
			<table class="tbl">
				<caption class="sr-only"
					>Topics in the routing table and topics holding retained state</caption
				>
				<thead>
					<tr>
						<SortHeader column="topic" label="Topic" active={sortBy} {direction} {onsort} />
						<th scope="col">Kind</th>
						<th scope="col">Present in</th>
						<SortHeader
							column="subscribers"
							label="Subscribers"
							align="right"
							active={sortBy}
							{direction}
							{onsort}
						/>
						<th scope="col" class="text-right">Sessions</th>
						<th scope="col" class="text-right">QoS 0/1/2</th>
						<SortHeader column="nodes" label="Nodes" active={sortBy} {direction} {onsort} />
						<th scope="col">Shared</th>
						<SortHeader
							column="retainedBytes"
							label="Retained"
							align="right"
							active={sortBy}
							{direction}
							{onsort}
						/>
						<th scope="col" class="sticky-actions text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each sorted as row (row.topic)}
						<tr>
							<td class="mono truncate-cell text-[var(--text)]" title={row.topic}>{row.topic}</td>
							<td>
								<span
									class="chip"
									style={row.wildcard
										? 'background:var(--brand-soft);color:var(--brand-ink)'
										: 'background:var(--surface-3);color:var(--text-muted)'}
								>
									{row.wildcard ? 'wildcard' : 'exact'}
								</span>
							</td>
							<td class="text-[11px] whitespace-nowrap">
								{#if row.routed}<span class="text-[var(--text-2)]">routing table</span>{/if}
								{#if row.routed && row.retainedBytes !== null}<span
										class="text-[var(--text-muted)]"
									>
										·
									</span>{/if}
								{#if row.retainedBytes !== null}<span class="text-[var(--text-2)]">retained</span
									>{/if}
							</td>
							<td class="num">{row.subscribers || '—'}</td>
							<td class="num">{row.sessions || '—'}</td>
							<td class="num whitespace-nowrap">{row.qos[0]} / {row.qos[1]} / {row.qos[2]}</td>
							<td class="mono">{row.nodes.length ? row.nodes.join(', ') : '—'}</td>
							<td class="mono truncate-cell">{row.shares.join(', ') || '—'}</td>
							<td class="num">{row.retainedBytes === null ? '—' : bytes(row.retainedBytes)}</td>
							<td class="sticky-actions text-right whitespace-nowrap">
								<a
									href="/topics/monitor?t={encodeURIComponent(row.topic)}"
									class="btn btn-ghost btn-sm"
									title="Subscribe and stream live messages"
								>
									<Icon name="monitor" size={12} /> Monitor
								</a>
								{#if row.retainedBytes !== null}
									<a
										href="/retained?topic_filter={encodeURIComponent(row.topic)}"
										class="btn btn-ghost btn-sm"
									>
										<Icon name="retained" size={12} /> Retained
									</a>
								{/if}
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="10" class="px-4 py-10 text-center text-xs text-[var(--text-muted)]">
								{routes.initialLoading
									? 'Reading the routing table…'
									: 'No topics match these filters.'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>

	<p class="text-[11px] text-[var(--text-muted)]">
		The routing table holds <em>subscription filters</em>, not the concrete topics messages are
		published to — a filter appears only while at least one session subscribes to it. Concrete
		topics carrying retained state are merged in from
		<code class="mono">/api/v1/retains</code>. To see the actual topics traffic is flowing on, use
		the monitor.
	</p>
</div>
