<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { api } from '$lib/api/client';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import SortHeader from '$lib/components/SortHeader.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { Resource } from '$lib/stores/resource.svelte';
	import { cluster } from '$lib/stores/cluster.svelte';
	import { setPageMeta } from '$lib/stores/pageMeta.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import {
		DEFAULT_DISCOVERY_FILTER,
		publishedTopics,
		type PublishedTopic
	} from '$lib/stores/publishedTopics.svelte';
	import { bytes, clock, compact, rate as fmtRate, relative } from '$lib/utils/format';
	import { compileFilter, validateFilter } from '$lib/utils/mqtt-topic';
	import { download, timestampedName, toCsv } from '$lib/utils/download';
	import type { RetainedPage, SubscriptionInfo } from '$lib/types';

	setPageMeta('Topics', 'Concrete topics messages are being published to');

	/* -------------------------------------------------------------- discovery */

	let filterInput = $state(publishedTopics.filter);
	const filterError = $derived(validateFilter(filterInput.trim()));

	onMount(() => publishedTopics.start());
	// Discovery is paused rather than stopped, so the tally survives navigation
	// without leaving a wildcard subscription open in the background.
	onDestroy(() => publishedTopics.pause());

	function applyFilter() {
		const next = filterInput.trim();
		if (validateFilter(next)) return;
		publishedTopics.clear();
		publishedTopics.start(next);
	}

	/* ------------------------------------------------------------- reference */

	/* Subscriptions are read so each published topic can show how many
	   subscriptions match it — a topic with none is traffic nobody consumes. */
	const subs = new Resource<SubscriptionInfo[]>((signal) =>
		api.subscriptions({ _limit: settings.current.pageSize }, signal)
	);
	/* Retained topics are concrete and published-by-definition, so they are
	   merged in: a topic can hold retained state without being active now. */
	const retains = new Resource<RetainedPage>((signal) =>
		api.retains({ topic_filter: '#', offset: 0, limit: settings.current.pageSize }, signal)
	);

	onMount(() => {
		subs.start(Math.max(settings.current.refreshMs, 10_000));
		retains.start(Math.max(settings.current.refreshMs, 15_000));
	});
	onDestroy(() => {
		subs.stop();
		retains.stop();
	});

	/**
	 * Compiled once per subscription list, not once per row.
	 *
	 * The dashboard's own bridge is excluded. Discovery subscribes to `+/#`,
	 * which the broker puts in the routing table like any other subscription, so
	 * counting it would add one to every topic and make "nobody subscribed"
	 * permanently read zero — the observer would be hiding what it observes.
	 */
	const matchers = $derived(
		(subs.data ?? [])
			.filter((s) => s.clientid !== cluster.bridgeClientId)
			.map((s) => ({ topic: s.topic, match: compileFilter(s.topic) }))
	);

	function matchingSubs(topic: string): number {
		let n = 0;
		for (const m of matchers) if (m.match(topic)) n++;
		return n;
	}

	/* ------------------------------------------------------------------ rows */

	interface Row extends PublishedTopic {
		/** Listed by the retain store but not seen live during this session. */
		retainedOnly: boolean;
	}

	const rows = $derived.by(() => {
		const seen = new Map<string, Row>();
		for (const t of publishedTopics.topics) {
			seen.set(t.topic, { ...t, retainedOnly: false });
		}
		for (const item of retains.data?.items ?? []) {
			const existing = seen.get(item.topic);
			if (existing) {
				existing.retained = true;
				continue;
			}
			seen.set(item.topic, {
				topic: item.topic,
				messages: 0,
				bytes: 0,
				rate: 0,
				lastSeen: item.publish.create_time ?? 0,
				lastSize: 0,
				qos: [item.publish.qos],
				retained: true,
				retainedOnly: true
			});
		}
		return [...seen.values()];
	});

	let search = $state('');
	let onlyUnconsumed = $state(false);

	const filtered = $derived(
		rows.filter((row) => {
			if (search.trim() && !row.topic.toLowerCase().includes(search.trim().toLowerCase())) {
				return false;
			}
			if (onlyUnconsumed && matchingSubs(row.topic) > 0) return false;
			return true;
		})
	);

	type Column = 'topic' | 'messages' | 'rate' | 'lastSeen' | 'bytes';
	let sortBy = $state<Column>('messages');
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
			const cmp =
				sortBy === 'topic'
					? a.topic.localeCompare(b.topic)
					: (a[sortBy] as number) - (b[sortBy] as number);
			return direction === 'asc' ? cmp : -cmp;
		})
	);

	/** Capped for rendering; the counts above always describe the whole set. */
	const LIMIT = 300;
	const visible = $derived(sorted.slice(0, LIMIT));

	const unconsumed = $derived(rows.filter((r) => matchingSubs(r.topic) === 0).length);
	const totalRate = $derived(publishedTopics.topics.reduce((sum, t) => sum + t.rate, 0));

	const error = $derived(subs.error ?? retains.error);

	function exportCsv() {
		const columns = [
			'topic',
			'messages_observed',
			'messages_per_second',
			'total_bytes',
			'last_payload_bytes',
			'last_seen',
			'qos_seen',
			'retained',
			'matching_subscriptions'
		];
		const data = sorted.map((r) => ({
			topic: r.topic,
			messages_observed: r.messages,
			messages_per_second: r.rate.toFixed(3),
			total_bytes: r.bytes,
			last_payload_bytes: r.lastSize,
			last_seen: r.lastSeen ? new Date(r.lastSeen).toISOString() : '',
			qos_seen: r.qos.join(' '),
			retained: r.retained,
			matching_subscriptions: matchingSubs(r.topic)
		}));
		download(
			timestampedName('rmqtt-published-topics', 'csv'),
			toCsv(columns, data),
			'text/csv;charset=utf-8'
		);
		toasts.success('Exported', `${data.length} topics written to CSV.`);
	}
</script>

<div class="flex flex-col gap-4">
	<section class="grid grid-cols-2 gap-4 lg:grid-cols-4">
		<StatCard
			label="Topics published to"
			value={compact(publishedTopics.distinctTopics)}
			icon="topics"
			footnote={publishedTopics.startedAt
				? `observed since ${clock(publishedTopics.startedAt)}`
				: 'starting…'}
		/>
		<StatCard
			label="Messages observed"
			value={compact(publishedTopics.totalMessages)}
			icon="overview"
			footnote="{fmtRate(totalRate)} msg/s across all topics"
		/>
		<StatCard
			label="Nobody subscribed"
			value={compact(unconsumed)}
			icon="warning"
			footnote="no subscription filter matches"
		/>
		<StatCard
			label="In the routing table"
			value={compact(cluster.stat('topics.count'))}
			icon="subscriptions"
			href="/subscriptions"
			footnote="subscription filters, not published topics"
		/>
	</section>

	<!-- Discovery controls -->
	<section class="card p-3">
		<form
			class="flex flex-wrap items-end gap-3"
			onsubmit={(e) => {
				e.preventDefault();
				applyFilter();
			}}
		>
			<div class="min-w-56 flex-1">
				<label class="label" for="d-filter">Discover under</label>
				<input
					id="d-filter"
					class="input mono"
					bind:value={filterInput}
					autocomplete="off"
					spellcheck="false"
					aria-invalid={filterError ? 'true' : undefined}
					aria-describedby="d-filter-hint"
				/>
				<p id="d-filter-hint" class="mt-1 text-[11px]">
					{#if filterError}
						<span style="color:var(--critical-ink)">{filterError}</span>
					{:else}
						<span class="text-[var(--text-muted)]">
							<code class="mono">{DEFAULT_DISCOVERY_FILTER}</code> covers every application topic at
							any depth. A bare <code class="mono">#</code> is refused by rmqtt's default ACL for
							any client not on the broker's host, and would also pull in
							<code class="mono">$SYS</code>.
						</span>
					{/if}
				</p>
			</div>

			<button type="submit" class="btn btn-ghost" disabled={Boolean(filterError)}>
				<Icon name="refresh" size={13} /> Restart discovery
			</button>
			{#if publishedTopics.observing}
				<button type="button" class="btn btn-ghost" onclick={() => publishedTopics.pause()}>
					<Icon name="pause" size={13} /> Pause
				</button>
			{:else}
				<button type="button" class="btn btn-primary" onclick={() => publishedTopics.start()}>
					<Icon name="play" size={13} filled /> Resume
				</button>
			{/if}
			<button
				type="button"
				class="btn btn-ghost"
				onclick={() => publishedTopics.clear()}
				disabled={publishedTopics.totalMessages === 0}
			>
				<Icon name="trash" size={13} /> Clear
			</button>
		</form>

		<div class="mt-2.5 flex flex-wrap items-center gap-3">
			<StatusChip
				tone={publishedTopics.observing
					? publishedTopics.status === 'connected'
						? 'good'
						: 'warning'
					: 'neutral'}
				label={publishedTopics.observing
					? publishedTopics.status === 'connected'
						? `Observing ${publishedTopics.filter}`
						: publishedTopics.status
					: 'Paused'}
				icon={publishedTopics.observing ? undefined : 'pause'}
			/>
			<span class="text-[11px] text-[var(--text-muted)]">
				Discovery watches live traffic through the shared server-side subscription, so the broker
				sees one subscriber however many tabs are open. It pauses when you leave this page.
			</span>
		</div>

		{#if publishedTopics.rejected.length > 0}
			<div
				class="mt-2.5 flex items-start gap-2.5 rounded-lg border px-3 py-2.5"
				style="border-color:color-mix(in srgb, var(--warning) 40%, transparent);background:var(--warning-soft)"
				role="alert"
			>
				<span style="color:var(--warning-ink)" class="mt-0.5 shrink-0">
					<Icon name="warning" size={14} />
				</span>
				<div class="text-xs text-[var(--text-2)]">
					<p class="font-medium" style="color:var(--warning-ink)">
						The broker refused this subscription
					</p>
					{#each publishedTopics.rejected as row (row.filter)}
						<p class="mt-0.5">
							<code class="mono">{row.filter}</code>{#if row.error}
								— {row.error}{/if}
						</p>
					{/each}
					<p class="mt-1.5">
						Try <code class="mono">{DEFAULT_DISCOVERY_FILTER}</code>, or adjust
						<code class="mono">plugins/rmqtt-acl.toml</code>. Nothing can be discovered without a
						subscription the ACL permits.
					</p>
				</div>
			</div>
		{/if}

		{#if publishedTopics.dropped > 0}
			<p class="mt-2 text-[11px]" style="color:var(--warning-ink)">
				<Icon name="warning" size={11} class="inline align-[-1px]" />
				{compact(publishedTopics.dropped)} message{publishedTopics.dropped === 1 ? '' : 's'} dropped by
				the server-side rate limit, so counts below understate the real volume. Raise
				<code class="mono">RMQTT_MONITOR_RATE_LIMIT</code> if this matters.
			</p>
		{/if}
		{#if publishedTopics.evicting}
			<p class="mt-2 text-[11px] text-[var(--text-muted)]">
				<Icon name="info" size={11} class="inline align-[-1px]" />
				More than 5,000 distinct topics seen; the least recently used are being dropped. Narrow the discovery
				filter for a stable list.
			</p>
		{/if}
	</section>

	{#if error}
		<ErrorBanner
			message={error}
			onretry={() => {
				void subs.refresh();
				void retains.refresh();
			}}
		/>
	{/if}

	<section class="card overflow-hidden">
		<header
			class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3"
		>
			<div class="min-w-48 flex-1">
				<div class="relative">
					<span
						class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--text-muted)]"
					>
						<Icon name="search" size={13} />
					</span>
					<input
						class="input mono pl-8"
						placeholder="Filter observed topics"
						bind:value={search}
						autocomplete="off"
						aria-label="Filter observed topics"
					/>
				</div>
			</div>

			<label class="flex items-center gap-1.5 text-xs text-[var(--text-2)]">
				<input
					type="checkbox"
					class="h-3.5 w-3.5 rounded border-[var(--border-strong)]"
					bind:checked={onlyUnconsumed}
				/>
				Only topics with no subscriber
			</label>

			<span class="text-[11px] text-[var(--text-muted)] tabular-nums">
				{compact(sorted.length)} of {compact(rows.length)}
			</span>

			<button
				type="button"
				class="btn btn-ghost btn-sm"
				onclick={exportCsv}
				disabled={sorted.length === 0}
			>
				<Icon name="download" size={13} /> Export CSV
			</button>
		</header>

		<div class="overflow-x-auto">
			{#if rows.length === 0}
				<EmptyState
					icon="topics"
					title={publishedTopics.observing ? 'Waiting for a published message' : 'Discovery paused'}
					body={publishedTopics.observing
						? `Subscribed to ${publishedTopics.filter}. Every topic something is published to from now on appears here, with its rate and whether anything is subscribed to it.`
						: 'Resume discovery to start listing the topics messages are published to.'}
				/>
			{:else}
				<table class="tbl">
					<caption class="sr-only">Concrete topics observed being published to</caption>
					<thead>
						<tr>
							<SortHeader column="topic" label="Topic" active={sortBy} {direction} {onsort} />
							<SortHeader
								column="messages"
								label="Messages"
								align="right"
								active={sortBy}
								{direction}
								{onsort}
							/>
							<SortHeader
								column="rate"
								label="Msg/s"
								align="right"
								active={sortBy}
								{direction}
								{onsort}
							/>
							<th scope="col" class="text-right">QoS</th>
							<SortHeader
								column="bytes"
								label="Payload"
								align="right"
								active={sortBy}
								{direction}
								{onsort}
							/>
							<th scope="col" class="text-right">Last size</th>
							<SortHeader
								column="lastSeen"
								label="Last seen"
								active={sortBy}
								{direction}
								{onsort}
							/>
							<th scope="col" class="text-right">Subscribers</th>
							<th scope="col">Retained</th>
							<th scope="col" class="sticky-actions text-right">Actions</th>
						</tr>
					</thead>
					<tbody>
						{#each visible as row (row.topic)}
							{@const matches = matchingSubs(row.topic)}
							<tr>
								<td class="mono truncate-cell text-[var(--text)]" title={row.topic}>{row.topic}</td>
								<td class="num">{row.retainedOnly ? '—' : compact(row.messages)}</td>
								<td class="num">{row.rate > 0 ? fmtRate(row.rate) : '—'}</td>
								<td class="num">{row.qos.join(', ')}</td>
								<td class="num">{row.bytes ? bytes(row.bytes) : '—'}</td>
								<td class="num">{row.lastSize ? bytes(row.lastSize) : '—'}</td>
								<td
									class="whitespace-nowrap tabular-nums"
									title={row.lastSeen ? new Date(row.lastSeen).toISOString() : ''}
								>
									{row.lastSeen ? relative(row.lastSeen) : '—'}
								</td>
								<td class="num">
									{#if matches === 0}
										<span
											style="color:var(--warning-ink)"
											title="No subscription filter matches this topic"
										>
											0
										</span>
									{:else}
										{matches}
									{/if}
								</td>
								<td>
									{#if row.retained}
										<a
											href="/retained?topic_filter={encodeURIComponent(row.topic)}"
											class="chip"
											style="background:var(--brand-soft);color:var(--brand-ink)"
										>
											retained
										</a>
									{:else}
										<span class="text-[var(--text-muted)]">—</span>
									{/if}
								</td>
								<td class="sticky-actions text-right whitespace-nowrap">
									<a
										href="/topics/monitor?t={encodeURIComponent(row.topic)}"
										class="btn btn-ghost btn-sm"
									>
										<Icon name="monitor" size={12} /> Monitor
									</a>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

		{#if sorted.length > LIMIT}
			<footer
				class="flex items-center gap-1.5 border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-[11px] text-[var(--text-muted)]"
			>
				<Icon name="info" size={12} />
				Showing the top {LIMIT} of {compact(sorted.length)} by {sortBy}. The counts above and the
				CSV export cover all of them.
			</footer>
		{/if}
	</section>

	<p class="text-[11px] text-[var(--text-muted)]">
		These are the concrete topics messages actually arrive on, discovered by watching live traffic —
		the broker has no endpoint that lists them. <code class="mono">/api/v1/routes</code> and
		<code class="mono">stats.topics.count</code> describe the routing table, which holds
		subscription
		<em>filters</em> such as <code class="mono">demo/+/temp</code>; those are on the
		<a href="/subscriptions" class="underline">Subscriptions</a> page. Topics holding retained state
		are merged in from <code class="mono">/api/v1/retains</code> even when nothing is publishing to them
		right now. Subscriber counts exclude the dashboard's own discovery subscription, which the broker
		lists in the routing table like any other.
	</p>
</div>
