<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { api, type SubscriptionQuery } from '$lib/api/client';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import SortHeader from '$lib/components/SortHeader.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import { Resource } from '$lib/stores/resource.svelte';
	import { cluster } from '$lib/stores/cluster.svelte';
	import { setPageMeta } from '$lib/stores/pageMeta.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { compact, relative } from '$lib/utils/format';
	import { download, timestampedName, toCsv } from '$lib/utils/download';
	import { subQos, subShare, type SubscriptionInfo } from '$lib/types';

	setPageMeta('Subscriptions', 'Every subscription in the cluster, flat or grouped by filter');

	/* ------------------------------------------------------------------ filters */

	let clientid = $state('');
	let topic = $state('');
	let matchTopic = $state('');
	let qos = $state<'' | '0' | '1' | '2'>('');
	let share = $state('');

	let applied = $state({ clientid: '', topic: '', matchTopic: '', share: '' });

	$effect(() => {
		const next = { clientid, topic, matchTopic, share };
		const timer = setTimeout(() => (applied = next), 350);
		return () => clearTimeout(timer);
	});

	const query = $derived<SubscriptionQuery>({
		_limit: settings.current.pageSize,
		clientid: applied.clientid || undefined,
		topic: applied.topic || undefined,
		_match_topic: applied.matchTopic || undefined,
		share: applied.share || undefined,
		qos: qos === '' ? undefined : Number(qos)
	});

	const hasFilters = $derived(
		Boolean(applied.clientid || applied.topic || applied.matchTopic || applied.share) || qos !== ''
	);

	function clearFilters() {
		clientid = '';
		topic = '';
		matchTopic = '';
		share = '';
		qos = '';
		applied = { clientid: '', topic: '', matchTopic: '', share: '' };
	}

	/* --------------------------------------------------------------------- data */

	const subs = new Resource<SubscriptionInfo[]>((signal) =>
		api.subscriptions(
			untrack(() => query),
			signal
		)
	);

	onMount(() => subs.start(settings.current.refreshMs));
	onDestroy(() => subs.stop());
	$effect(() => subs.setInterval(settings.current.refreshMs));
	$effect(() => {
		void query;
		void subs.refresh();
	});

	/**
	 * The dashboard's own subscriptions, excluded by default.
	 *
	 * Its server-side bridge holds `$SYS/#` for the live feed, and `+/#` while
	 * the Topics page is discovering. The broker lists both like any other
	 * subscription, so leaving them in inflates every figure on this page and
	 * makes the observer part of what it observes. They are hidden rather than
	 * dropped: the count is shown, and the toggle brings them back for anyone
	 * auditing against the broker's own subscriptions.count.
	 */
	let includeSelf = $state(false);

	const ownRows = $derived((subs.data ?? []).filter((s) => s.clientid === cluster.bridgeClientId));

	const rows = $derived(
		includeSelf
			? (subs.data ?? [])
			: (subs.data ?? []).filter((s) => s.clientid !== cluster.bridgeClientId)
	);

	/* ------------------------------------------------------- derived metrics */

	const isWildcard = (t: string) => t.includes('+') || t.includes('#');

	/**
	 * rmqtt exposes no per-subscription counters, so the "related metrics" here
	 * are aggregates computed over the subscription table itself: how many
	 * sessions hold each filter, on which nodes, at which QoS, and whether it is
	 * a shared group. That is the whole of what the API can tell us.
	 */
	interface Grouped {
		topic: string;
		subscribers: number;
		clients: string[];
		nodes: number[];
		qos: [number, number, number];
		shares: string[];
		wildcard: boolean;
	}

	const grouped = $derived.by(() => {
		const map = new Map<string, Grouped>();
		for (const sub of rows) {
			let entry = map.get(sub.topic);
			if (!entry) {
				entry = {
					topic: sub.topic,
					subscribers: 0,
					clients: [],
					nodes: [],
					qos: [0, 0, 0],
					shares: [],
					wildcard: isWildcard(sub.topic)
				};
				map.set(sub.topic, entry);
			}
			entry.subscribers++;
			if (!entry.clients.includes(sub.clientid)) entry.clients.push(sub.clientid);
			if (!entry.nodes.includes(sub.node_id)) entry.nodes.push(sub.node_id);
			const q = subQos(sub);
			if (q >= 0 && q <= 2) entry.qos[q]++;
			const group = subShare(sub);
			if (group && !entry.shares.includes(group)) entry.shares.push(group);
		}
		return [...map.values()];
	});

	const summary = $derived({
		total: rows.length,
		shared: rows.filter((s) => subShare(s) !== null).length,
		filters: grouped.length,
		wildcards: grouped.filter((g) => g.wildcard).length,
		clients: new Set(rows.map((s) => s.clientid)).size
	});

	/* ------------------------------------------------------------------- view */

	let view = $state<'flat' | 'grouped'>('flat');

	type FlatColumn = 'clientid' | 'topic' | 'qos' | 'share' | 'node_id';
	let sortBy = $state<FlatColumn>('topic');
	let direction = $state<'asc' | 'desc'>('asc');

	function onsort(column: FlatColumn) {
		if (sortBy === column) direction = direction === 'asc' ? 'desc' : 'asc';
		else {
			sortBy = column;
			direction = 'asc';
		}
	}

	function flatValue(sub: SubscriptionInfo, column: FlatColumn): string | number {
		switch (column) {
			case 'qos':
				return subQos(sub);
			case 'share':
				return subShare(sub) ?? '';
			case 'node_id':
				return sub.node_id;
			default:
				return sub[column] ?? '';
		}
	}

	const flatRows = $derived(
		[...rows].sort((a, b) => {
			const va = flatValue(a, sortBy);
			const vb = flatValue(b, sortBy);
			const cmp =
				typeof va === 'number' && typeof vb === 'number'
					? va - vb
					: String(va).localeCompare(String(vb));
			return direction === 'asc' ? cmp : -cmp;
		})
	);

	type GroupColumn = 'topic' | 'subscribers' | 'nodes';
	let groupSortBy = $state<GroupColumn>('subscribers');
	let groupDirection = $state<'asc' | 'desc'>('desc');

	function ongroupsort(column: GroupColumn) {
		if (groupSortBy === column) groupDirection = groupDirection === 'asc' ? 'desc' : 'asc';
		else {
			groupSortBy = column;
			groupDirection = column === 'topic' ? 'asc' : 'desc';
		}
	}

	const groupRows = $derived(
		[...grouped].sort((a, b) => {
			const cmp =
				groupSortBy === 'topic'
					? a.topic.localeCompare(b.topic)
					: groupSortBy === 'nodes'
						? a.nodes.length - b.nodes.length
						: a.subscribers - b.subscribers;
			return groupDirection === 'asc' ? cmp : -cmp;
		})
	);

	function exportCsv() {
		if (view === 'flat') {
			const data = flatRows.map((s) => ({
				clientid: s.clientid,
				topic: s.topic,
				qos: subQos(s),
				share: subShare(s) ?? '',
				node_id: s.node_id,
				client_addr: s.client_addr ?? ''
			}));
			download(
				timestampedName('rmqtt-subscriptions', 'csv'),
				toCsv(['clientid', 'topic', 'qos', 'share', 'node_id', 'client_addr'], data),
				'text/csv;charset=utf-8'
			);
		} else {
			const data = groupRows.map((g) => ({
				topic: g.topic,
				wildcard: g.wildcard,
				subscribers: g.subscribers,
				distinct_clients: g.clients.length,
				nodes: g.nodes.join(' '),
				qos0: g.qos[0],
				qos1: g.qos[1],
				qos2: g.qos[2],
				shared_groups: g.shares.join(' ')
			}));
			download(
				timestampedName('rmqtt-subscription-filters', 'csv'),
				toCsv(
					[
						'topic',
						'wildcard',
						'subscribers',
						'distinct_clients',
						'nodes',
						'qos0',
						'qos1',
						'qos2',
						'shared_groups'
					],
					data
				),
				'text/csv;charset=utf-8'
			);
		}
		toasts.success('Exported', 'Subscription data written to CSV.');
	}

	const limitReached = $derived(rows.length >= settings.current.pageSize);
</script>

<div class="flex flex-col gap-4">
	<section class="grid grid-cols-2 gap-4 lg:grid-cols-5">
		<StatCard label="Subscriptions" value={compact(summary.total)} icon="subscriptions" />
		<StatCard label="Topic filters" value={compact(summary.filters)} icon="topics" />
		<StatCard
			label="Wildcard filters"
			value={compact(summary.wildcards)}
			icon="filter"
			footnote="contain + or #"
		/>
		<StatCard
			label="Shared subscriptions"
			value={compact(summary.shared)}
			icon="clients"
			footnote="$share/{'{group}'}/…"
		/>
		<StatCard
			label="Subscribing sessions"
			value={compact(summary.clients)}
			icon="clients"
			href="/clients"
		/>
	</section>

	<section class="card flex flex-wrap items-end gap-3 p-3">
		<div class="min-w-44 flex-1">
			<label class="label" for="f-topic">Topic filter (exact)</label>
			<input
				id="f-topic"
				class="input mono"
				placeholder="demo/+/temp"
				bind:value={topic}
				autocomplete="off"
			/>
		</div>
		<div class="min-w-44 flex-1">
			<label class="label" for="f-match">Matches topic</label>
			<input
				id="f-match"
				class="input mono"
				placeholder="demo/x/temp"
				bind:value={matchTopic}
				autocomplete="off"
				title="Returns every subscription whose filter would match this concrete topic"
			/>
		</div>
		<div class="min-w-40 flex-1">
			<label class="label" for="f-client">Client ID (exact)</label>
			<input
				id="f-client"
				class="input mono"
				placeholder="sensor-a1"
				bind:value={clientid}
				autocomplete="off"
			/>
		</div>
		<div class="min-w-28">
			<label class="label" for="f-share">Shared group</label>
			<input id="f-share" class="input" placeholder="g1" bind:value={share} autocomplete="off" />
		</div>
		<div class="min-w-24">
			<label class="label" for="f-qos">QoS</label>
			<select id="f-qos" class="input" bind:value={qos}>
				<option value="">Any</option>
				<option value="0">0</option>
				<option value="1">1</option>
				<option value="2">2</option>
			</select>
		</div>
		{#if hasFilters}
			<button type="button" class="btn btn-ghost" onclick={clearFilters}>
				<Icon name="close" size={13} /> Clear
			</button>
		{/if}
	</section>

	{#if subs.error}
		<ErrorBanner message={subs.error} onretry={() => subs.refresh()} />
	{/if}

	<section class="card overflow-hidden">
		<header
			class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3"
		>
			<div>
				<h2 class="text-sm font-semibold text-[var(--text)]">
					{compact(rows.length)} subscription{rows.length === 1 ? '' : 's'}
					across {compact(grouped.length)} filter{grouped.length === 1 ? '' : 's'}
				</h2>
				<p class="mt-0.5 text-[11px] text-[var(--text-muted)]">
					{#if subs.loadedAt}Read {relative(subs.loadedAt)}{/if}
					{#if ownRows.length > 0 && !includeSelf}
						· {ownRows.length} of this dashboard's own hidden
					{/if}
				</p>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				{#if ownRows.length > 0 || includeSelf}
					<label class="flex items-center gap-1.5 text-xs text-[var(--text-2)]">
						<input
							type="checkbox"
							class="h-3.5 w-3.5 rounded border-[var(--border-strong)]"
							bind:checked={includeSelf}
						/>
						Include this dashboard
					</label>
				{/if}
				<div class="flex rounded-md border border-[var(--border-strong)] p-0.5 text-xs">
					<button
						type="button"
						class="rounded px-2 py-1"
						style={view === 'flat'
							? 'background:var(--surface-3);color:var(--text)'
							: 'color:var(--text-muted)'}
						aria-pressed={view === 'flat'}
						onclick={() => (view = 'flat')}
					>
						Each subscription
					</button>
					<button
						type="button"
						class="rounded px-2 py-1"
						style={view === 'grouped'
							? 'background:var(--surface-3);color:var(--text)'
							: 'color:var(--text-muted)'}
						aria-pressed={view === 'grouped'}
						onclick={() => (view = 'grouped')}
					>
						By filter
					</button>
				</div>
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					onclick={exportCsv}
					disabled={rows.length === 0}
				>
					<Icon name="download" size={13} /> Export CSV
				</button>
			</div>
		</header>

		<div class="overflow-x-auto" class:opacity-60={subs.initialLoading}>
			{#if view === 'flat'}
				<table class="tbl">
					<caption class="sr-only">Every subscription held in the cluster</caption>
					<thead>
						<tr>
							<SortHeader
								column="topic"
								label="Topic filter"
								active={sortBy}
								{direction}
								{onsort}
							/>
							<SortHeader
								column="clientid"
								label="Client ID"
								active={sortBy}
								{direction}
								{onsort}
							/>
							<SortHeader
								column="qos"
								label="QoS"
								align="right"
								active={sortBy}
								{direction}
								{onsort}
							/>
							<SortHeader
								column="share"
								label="Shared group"
								active={sortBy}
								{direction}
								{onsort}
							/>
							<SortHeader
								column="node_id"
								label="Node"
								align="right"
								active={sortBy}
								{direction}
								{onsort}
							/>
							<th scope="col">Client address</th>
							<th scope="col" class="sticky-actions text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each flatRows as sub, i (sub.clientid + sub.topic + sub.node_id + i)}
							<tr>
								<td class="mono truncate-cell text-[var(--text)]" title={sub.topic}>{sub.topic}</td>
								<td>
									<a
										href="/clients?clientid={encodeURIComponent(sub.clientid)}"
										class="mono truncate-cell text-[var(--text-2)] hover:text-[var(--brand-ink)]"
									>
										{sub.clientid}
									</a>
									{#if sub.clientid === cluster.bridgeClientId}
										<span
											class="chip ml-1.5 align-middle"
											style="background:var(--surface-3);color:var(--text-muted)"
											title="Held by this dashboard's own $SYS and topic-discovery connection"
										>
											this dashboard
										</span>
									{/if}
								</td>
								<td class="num">{subQos(sub)}</td>
								<td class="mono">{subShare(sub) ?? '—'}</td>
								<td class="num">{sub.node_id}</td>
								<td class="mono text-[var(--text-muted)]">{sub.client_addr ?? '—'}</td>
								<td class="sticky-actions text-right whitespace-nowrap">
									<a
										href="/topics/monitor?t={encodeURIComponent(sub.topic)}"
										class="btn btn-ghost btn-sm"
										title="Stream live messages matching this filter"
									>
										<Icon name="monitor" size={12} /> Monitor
									</a>
								</td>
							</tr>
						{:else}
							<tr>
								<td colspan="7" class="px-4 py-10 text-center text-xs text-[var(--text-muted)]">
									{subs.initialLoading
										? 'Reading subscriptions…'
										: hasFilters
											? 'No subscriptions match these filters.'
											: ownRows.length > 0
												? // "None in the cluster" would be untrue when the only
													// subscription present is the dashboard's own.
													"No client subscriptions — only this dashboard's own, which is hidden."
												: 'No subscriptions in the cluster.'}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{:else}
				<table class="tbl">
					<caption class="sr-only">Subscriptions aggregated by topic filter</caption>
					<thead>
						<tr>
							<SortHeader
								column="topic"
								label="Topic filter"
								active={groupSortBy}
								direction={groupDirection}
								onsort={ongroupsort}
							/>
							<th scope="col">Kind</th>
							<SortHeader
								column="subscribers"
								label="Subscribers"
								align="right"
								active={groupSortBy}
								direction={groupDirection}
								onsort={ongroupsort}
							/>
							<th scope="col" class="text-right">Sessions</th>
							<th scope="col">QoS 0 / 1 / 2</th>
							<SortHeader
								column="nodes"
								label="Nodes"
								active={groupSortBy}
								direction={groupDirection}
								onsort={ongroupsort}
							/>
							<th scope="col">Shared groups</th>
							<th scope="col" class="sticky-actions text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each groupRows as group (group.topic)}
							<tr>
								<td class="mono truncate-cell text-[var(--text)]" title={group.topic}
									>{group.topic}</td
								>
								<td>
									<span
										class="chip"
										style={group.wildcard
											? 'background:var(--brand-soft);color:var(--brand-ink)'
											: 'background:var(--surface-3);color:var(--text-muted)'}
									>
										{group.wildcard ? 'wildcard' : 'exact'}
									</span>
								</td>
								<td class="num">{group.subscribers}</td>
								<td class="num">{group.clients.length}</td>
								<td class="num whitespace-nowrap">
									{group.qos[0]} / {group.qos[1]} / {group.qos[2]}
								</td>
								<td class="mono">{group.nodes.join(', ')}</td>
								<td class="mono truncate-cell">{group.shares.join(', ') || '—'}</td>
								<td class="sticky-actions text-right whitespace-nowrap">
									<a
										href="/topics/monitor?t={encodeURIComponent(group.topic)}"
										class="btn btn-ghost btn-sm"
									>
										<Icon name="monitor" size={12} /> Monitor
									</a>
								</td>
							</tr>
						{:else}
							<tr>
								<td colspan="8" class="px-4 py-10 text-center text-xs text-[var(--text-muted)]">
									No subscriptions to group.
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

		{#if limitReached}
			<footer
				class="flex items-center gap-1.5 border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-[11px] text-[var(--text-muted)]"
			>
				<Icon name="info" size={12} />
				Showing the first {settings.current.pageSize} subscriptions — the broker's
				<code class="mono">_limit</code>. The grouped view aggregates only what was fetched.
			</footer>
		{/if}
	</section>

	<p class="text-[11px] text-[var(--text-muted)]">
		rmqtt keeps no per-subscription counters, so the figures above are aggregated from the
		subscription table itself: how many sessions hold each filter, on which nodes, at which QoS, and
		which shared groups it belongs to. For per-message behaviour, use the topic monitor. The
		dashboard's own subscriptions are left out — its bridge holds
		<code class="mono">$SYS/#</code> for the live feed, and <code class="mono">+/#</code> while the
		Topics page is discovering — so these counts describe your clients rather than the observer.
		Tick <em>Include this dashboard</em> to reconcile against the broker's own
		<code class="mono">subscriptions.count</code>.
	</p>
</div>
