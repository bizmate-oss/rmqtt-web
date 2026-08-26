<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { api, errorText } from '$lib/api/client';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import PayloadView from '$lib/components/PayloadView.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import { Resource } from '$lib/stores/resource.svelte';
	import { cluster } from '$lib/stores/cluster.svelte';
	import { setPageMeta } from '$lib/stores/pageMeta.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { bytes, compact, duration, relative, stamp } from '$lib/utils/format';
	import { base64ToBytes, preview } from '$lib/utils/payload';
	import { download, timestampedName, toCsv } from '$lib/utils/download';
	import {
		retainedFrom,
		type PayloadFormat,
		type RetainedMessage,
		type RetainedPage
	} from '$lib/types';

	setPageMeta('Retained messages', 'Stored last-known values, and the command to clear them');

	/* ------------------------------------------------------------- filtering */

	let topicFilter = $state('#');
	let applied = $state('#');
	let offset = $state(0);

	$effect(() => {
		const next = topicFilter.trim() || '#';
		const timer = setTimeout(() => {
			if (next !== applied) {
				applied = next;
				offset = 0;
			}
		}, 350);
		return () => clearTimeout(timer);
	});

	onMount(() => {
		const preset = page.url.searchParams.get('topic_filter');
		if (preset) {
			topicFilter = preset;
			applied = preset;
		}
	});

	const limit = $derived(settings.current.pageSize);

	/* ------------------------------------------------------------------ data */

	const retains = new Resource<RetainedPage>((signal) =>
		api.retains(
			untrack(() => ({ topic_filter: applied, offset, limit })),
			signal
		)
	);

	onMount(() => retains.start(Math.max(settings.current.refreshMs, 10_000)));
	onDestroy(() => retains.stop());
	$effect(() => retains.setInterval(Math.max(settings.current.refreshMs, 10_000)));
	$effect(() => {
		void applied;
		void offset;
		void limit;
		void retains.refresh();
	});

	/**
	 * Topics the broker has confirmed cleared, hidden until it stops listing them.
	 *
	 * Removal is applied asynchronously, and on the zero-length-publish fallback
	 * it travels through the retainer first, so the next read can still return the
	 * row — which looks like the action failed. Filtering here rather than editing
	 * the fetched list means a refresh cannot resurrect the row, and the entry is
	 * dropped again as soon as the broker agrees, so a clear that silently failed
	 * still reappears instead of being hidden for good.
	 */
	let cleared = $state<Set<string>>(new Set());

	const items = $derived((retains.data?.items ?? []).filter((i) => !cleared.has(i.topic)));
	const hasMore = $derived(retains.data?.has_more ?? false);

	$effect(() => {
		const listed = new Set((retains.data?.items ?? []).map((i) => i.topic));
		// `cleared` is read untracked so updating it cannot re-trigger this effect.
		const current = untrack(() => cleared);
		if (current.size === 0) return;
		const next = new Set([...current].filter((t) => listed.has(t)));
		if (next.size !== current.size) cleared = next;
	});

	const decoded = $derived(
		items.map((item) => ({ item, payload: base64ToBytes(item.publish.payload) }))
	);

	const totalBytes = $derived(decoded.reduce((sum, d) => sum + d.payload.byteLength, 0));

	/* Retained values are last-known-state: one that has not been refreshed in a
	   long time usually means the publisher went away, which is worth surfacing. */
	const oldest = $derived.by(() => {
		const times = items
			.map((i) => i.publish.create_time)
			.filter((t): t is number => typeof t === 'number' && t > 0);
		return times.length ? Math.min(...times) : null;
	});

	/* --------------------------------------------------------------- actions */

	let inspect = $state<RetainedMessage | null>(null);
	let inspectFormat = $state<PayloadFormat>(settings.current.payloadFormat);
	let confirmDelete = $state<RetainedMessage | null>(null);
	let confirmBulk = $state(false);
	let selected = $state<Set<string>>(new Set());
	let busy = $state(false);

	const allSelected = $derived(items.length > 0 && items.every((i) => selected.has(i.topic)));

	function toggleAll() {
		selected = allSelected ? new Set() : new Set(items.map((i) => i.topic));
	}

	function toggle(topic: string) {
		const next = new Set(selected);
		if (next.has(topic)) next.delete(topic);
		else next.add(topic);
		selected = next;
	}

	async function remove(msg: RetainedMessage) {
		busy = true;
		try {
			await api.deleteRetained(msg.topic);
			toasts.success('Retained message cleared', msg.topic);
			cleared = new Set([...cleared, msg.topic]);
			await retains.refresh();
		} catch (err) {
			toasts.error('Could not clear it', errorText(err));
		} finally {
			busy = false;
			confirmDelete = null;
			inspect = null;
		}
	}

	async function removeSelected() {
		busy = true;
		const topics = [...selected];
		const results = await Promise.allSettled(topics.map((t) => api.deleteRetained(t)));
		const failed = results.filter((r) => r.status === 'rejected').length;
		cleared = new Set([...cleared, ...topics.filter((_, i) => results[i].status === 'fulfilled')]);
		await retains.refresh();
		busy = false;
		confirmBulk = false;
		selected = new Set();

		if (failed === 0) {
			toasts.success(`Cleared ${topics.length} retained message${topics.length === 1 ? '' : 's'}`);
		} else {
			toasts.error(
				`Cleared ${topics.length - failed} of ${topics.length}`,
				`${failed} could not be cleared.`
			);
		}
	}

	function exportJson() {
		const rows = decoded.map(({ item, payload }) => ({
			topic: item.topic,
			qos: item.publish.qos,
			retain: item.publish.retain,
			published_at: item.publish.create_time
				? new Date(item.publish.create_time).toISOString()
				: null,
			from_client: retainedFrom(item),
			size_bytes: payload.byteLength,
			remaining_ttl_seconds: item.remaining_ttl ?? null,
			payload_base64: item.publish.payload
		}));
		download(
			timestampedName('rmqtt-retained', 'json'),
			JSON.stringify(
				{ topic_filter: applied, exported_at: new Date().toISOString(), messages: rows },
				null,
				2
			),
			'application/json'
		);
		toasts.success('Exported', `${rows.length} retained messages.`);
	}

	function exportCsv() {
		const rows = decoded.map(({ item, payload }) => ({
			topic: item.topic,
			qos: item.publish.qos,
			published_at: item.publish.create_time
				? new Date(item.publish.create_time).toISOString()
				: '',
			from_client: retainedFrom(item),
			size_bytes: payload.byteLength,
			remaining_ttl_seconds: item.remaining_ttl ?? '',
			payload_base64: item.publish.payload
		}));
		download(
			timestampedName('rmqtt-retained', 'csv'),
			toCsv(
				[
					'topic',
					'qos',
					'published_at',
					'from_client',
					'size_bytes',
					'remaining_ttl_seconds',
					'payload_base64'
				],
				rows
			),
			'text/csv;charset=utf-8'
		);
		toasts.success('Exported', `${rows.length} retained messages.`);
	}

	const inspectPayload = $derived(
		inspect ? base64ToBytes(inspect.publish.payload) : new Uint8Array(0)
	);
</script>

<div class="flex flex-col gap-4">
	<section class="grid grid-cols-2 gap-4 lg:grid-cols-4">
		<StatCard
			label="Retained in cluster"
			value={compact(cluster.stat('retained.count'))}
			icon="retained"
			footnote="reported by /api/v1/stats"
		/>
		<StatCard label="Matching this filter" value={compact(items.length)} icon="filter" />
		<StatCard label="Payload held" value={bytes(totalBytes)} icon="disk" footnote="on this page" />
		<StatCard
			label="Oldest value"
			value={oldest === null ? '—' : relative(oldest)}
			icon="clock"
			footnote={oldest === null ? 'nothing retained' : 'last published on this page'}
		/>
	</section>

	<section class="card flex flex-wrap items-end gap-3 p-3">
		<div class="min-w-64 flex-1">
			<label class="label" for="r-filter">Topic filter</label>
			<input
				id="r-filter"
				class="input mono"
				placeholder="#"
				bind:value={topicFilter}
				autocomplete="off"
				spellcheck="false"
			/>
			<p class="mt-1 text-[11px] text-[var(--text-muted)]">
				<code class="mono">#</code> lists everything. Wildcards <code class="mono">+</code> and
				<code class="mono">#</code> are supported.
			</p>
		</div>
		<button type="button" class="btn btn-ghost" onclick={() => retains.refresh()}>
			<Icon name="refresh" size={13} class={retains.loading ? 'animate-spin' : ''} /> Refresh
		</button>
	</section>

	{#if retains.error}
		<ErrorBanner message={retains.error} onretry={() => retains.refresh()} />
	{/if}

	<section class="card overflow-hidden">
		<header
			class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3"
		>
			<div>
				<h2 class="text-sm font-semibold text-[var(--text)]">
					{compact(items.length)} retained message{items.length === 1 ? '' : 's'}
					{#if offset > 0}<span class="text-[var(--text-muted)]"> from #{offset + 1}</span>{/if}
				</h2>
				<p class="mt-0.5 text-[11px] text-[var(--text-muted)]">
					Matching <code class="mono">{applied}</code>
					{#if retains.loadedAt}· read {relative(retains.loadedAt)}{/if}
				</p>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				{#if selected.size > 0}
					<span class="text-xs font-medium text-[var(--text-2)]">{selected.size} selected</span>
					<button type="button" class="btn btn-danger btn-sm" onclick={() => (confirmBulk = true)}>
						<Icon name="trash" size={13} /> Clear selected
					</button>
				{/if}
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					onclick={exportJson}
					disabled={items.length === 0}
				>
					<Icon name="download" size={13} /> JSON
				</button>
				<button
					type="button"
					class="btn btn-ghost btn-sm"
					onclick={exportCsv}
					disabled={items.length === 0}
				>
					<Icon name="download" size={13} /> CSV
				</button>
			</div>
		</header>

		<div class="overflow-x-auto" class:opacity-60={retains.initialLoading}>
			<table class="tbl">
				<caption class="sr-only">Retained messages held by the broker</caption>
				<thead>
					<tr>
						<th scope="col" class="w-8">
							<input
								type="checkbox"
								class="h-3.5 w-3.5 rounded border-[var(--border-strong)]"
								checked={allSelected}
								disabled={items.length === 0}
								onchange={toggleAll}
								aria-label="Select all retained messages on this page"
							/>
						</th>
						<th scope="col">Topic</th>
						<th scope="col" class="text-right">QoS</th>
						<th scope="col">Published by</th>
						<th scope="col">Published at</th>
						<th scope="col" class="text-right">Size</th>
						<th scope="col" class="text-right">TTL left</th>
						<th scope="col">Payload</th>
						<th scope="col" class="sticky-actions text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each decoded as { item, payload } (item.topic)}
						<tr>
							<td>
								<input
									type="checkbox"
									class="h-3.5 w-3.5 rounded border-[var(--border-strong)]"
									checked={selected.has(item.topic)}
									onchange={() => toggle(item.topic)}
									aria-label="Select {item.topic}"
								/>
							</td>
							<td>
								<button
									type="button"
									class="mono max-w-72 truncate text-left font-medium text-[var(--text)] hover:text-[var(--brand-ink)]"
									title={item.topic}
									onclick={() => (inspect = item)}
								>
									{item.topic}
								</button>
							</td>
							<td class="num">{item.publish.qos}</td>
							<td class="mono truncate-cell">{retainedFrom(item)}</td>
							<td
								class="whitespace-nowrap tabular-nums"
								title={item.publish.create_time ? stamp(item.publish.create_time) : ''}
							>
								{item.publish.create_time ? relative(item.publish.create_time) : '—'}
							</td>
							<td class="num">{bytes(payload.byteLength)}</td>
							<td class="num">
								{item.remaining_ttl === null || item.remaining_ttl === undefined
									? '—'
									: duration(item.remaining_ttl)}
							</td>
							<td class="mono truncate-cell text-[var(--text-2)]">{preview(payload, 80)}</td>
							<td class="sticky-actions text-right whitespace-nowrap">
								<button type="button" class="btn btn-ghost btn-sm" onclick={() => (inspect = item)}>
									<Icon name="eye" size={12} /> View
								</button>
								<button
									type="button"
									class="btn btn-danger btn-sm"
									onclick={() => (confirmDelete = item)}
								>
									<Icon name="trash" size={12} /> Clear
								</button>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="9" class="px-4 py-10 text-center text-xs text-[var(--text-muted)]">
								{retains.initialLoading
									? 'Reading retained messages…'
									: `No retained message matches ${applied}.`}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if offset > 0 || hasMore}
			<footer
				class="flex items-center justify-between gap-2 border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-2"
			>
				<span class="text-[11px] text-[var(--text-muted)]">
					Showing {offset + 1}–{offset + items.length}
				</span>
				<div class="flex gap-2">
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						disabled={offset === 0}
						onclick={() => (offset = Math.max(0, offset - limit))}
					>
						<Icon name="chevronRight" size={12} class="rotate-180" /> Previous
					</button>
					<button
						type="button"
						class="btn btn-ghost btn-sm"
						disabled={!hasMore}
						onclick={() => (offset = offset + limit)}
					>
						Next <Icon name="chevronRight" size={12} />
					</button>
				</div>
			</footer>
		{/if}
	</section>

	<p class="text-[11px] text-[var(--text-muted)]">
		<strong>Clear</strong> calls <code class="mono">DELETE /api/v1/retains</code>, which drops the
		stored value without publishing anything — a client subscribed to the topic receives nothing. On
		a broker that predates the endpoint the dashboard falls back to the MQTT-native removal, a
		zero-length publish with the retain flag set; that clears the value too, but MQTT has the server
		treat such a packet as a normal publication as well, so every live subscriber is handed an empty
		message. Retained state needs the <code class="mono">rmqtt-retainer</code> plugin.
	</p>
</div>

<Modal
	open={inspect !== null}
	title={inspect?.topic ?? ''}
	description="Retained message"
	size="lg"
	onclose={() => (inspect = null)}
>
	{#if inspect}
		<dl class="mb-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
			<div>
				<dt class="text-[10px] tracking-wide text-[var(--text-muted)] uppercase">QoS</dt>
				<dd class="text-xs text-[var(--text)]">{inspect.publish.qos}</dd>
			</div>
			<div>
				<dt class="text-[10px] tracking-wide text-[var(--text-muted)] uppercase">Published by</dt>
				<dd class="mono truncate text-[var(--text)]">{retainedFrom(inspect)}</dd>
			</div>
			<div>
				<dt class="text-[10px] tracking-wide text-[var(--text-muted)] uppercase">Published at</dt>
				<dd class="text-xs text-[var(--text)] tabular-nums">
					{inspect.publish.create_time ? stamp(inspect.publish.create_time) : '—'}
				</dd>
			</div>
			<div>
				<dt class="text-[10px] tracking-wide text-[var(--text-muted)] uppercase">TTL left</dt>
				<dd class="text-xs text-[var(--text)]">
					{inspect.remaining_ttl === null || inspect.remaining_ttl === undefined
						? 'no expiry reported'
						: duration(inspect.remaining_ttl)}
				</dd>
			</div>
		</dl>
		<PayloadView payload={inspectPayload} bind:format={inspectFormat} maxHeight="24rem" />
	{/if}

	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={() => (inspect = null)}>Close</button>
		<button type="button" class="btn btn-danger" onclick={() => (confirmDelete = inspect)}>
			<Icon name="trash" size={13} /> Clear retained message
		</button>
	{/snippet}
</Modal>

<ConfirmDialog
	open={confirmDelete !== null}
	title="Clear retained message"
	body="The broker drops the stored value for this topic, so it is no longer replayed to new subscribers. Nothing is published, so current subscribers see no message. This cannot be undone."
	subject={confirmDelete?.topic}
	confirmLabel="Clear it"
	{busy}
	onconfirm={() => confirmDelete && remove(confirmDelete)}
	oncancel={() => (confirmDelete = null)}
/>

<ConfirmDialog
	open={confirmBulk}
	title="Clear {selected.size} retained messages"
	body="The stored value for each selected topic is dropped. Nothing is published, so current subscribers see no message. This cannot be undone."
	confirmLabel="Clear all"
	{busy}
	onconfirm={removeSelected}
	oncancel={() => (confirmBulk = false)}
/>
