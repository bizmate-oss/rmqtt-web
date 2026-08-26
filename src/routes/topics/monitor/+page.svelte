<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import Icon from '$lib/components/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import PayloadView from '$lib/components/PayloadView.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { TopicStream, type StreamMessage } from '$lib/stores/stream.svelte';
	import { setPageMeta } from '$lib/stores/pageMeta.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { bytes, clockMs, compact, rate as fmtRate, stamp } from '$lib/utils/format';
	import { bytesToBase64, formatPayload, preview, toText } from '$lib/utils/payload';
	import { download, timestampedName, toCsv } from '$lib/utils/download';
	import type { CapturedMessage, PayloadFormat } from '$lib/types';

	setPageMeta('Topic monitor', 'Subscribe to a filter and stream live messages');

	/* ---------------------------------------------------------------- filter */

	let filterInput = $state('#');
	let activeFilter = $state<string | null>(null);
	let stream = $state<TopicStream | null>(null);

	/**
	 * Validates an MQTT topic filter well enough to catch the mistakes that
	 * produce a silent no-match: `#` anywhere but the last level, and `+` or `#`
	 * sharing a level with other characters.
	 */
	function validateFilter(value: string): string | null {
		if (!value) return 'Enter a topic filter.';
		if (value.length > 65535) return 'Topic filter is too long.';
		const levels = value.split('/');
		for (let i = 0; i < levels.length; i++) {
			const level = levels[i];
			if (level.includes('#') && level !== '#') {
				return '`#` must occupy a whole level, as in `demo/#`.';
			}
			if (level === '#' && i !== levels.length - 1) {
				return '`#` is only valid as the last level.';
			}
			if (level.includes('+') && level !== '+') {
				return '`+` must occupy a whole level, as in `demo/+/temp`.';
			}
		}
		return null;
	}

	const filterError = $derived(validateFilter(filterInput.trim()));

	/* --------------------------------------------------------------- capture */

	let messages = $state<CapturedMessage[]>([]);
	let paused = $state(false);
	let skippedWhilePaused = $state(0);
	let totalReceived = $state(0);
	let selectedId = $state<number | null>(null);
	let format = $state<PayloadFormat>(settings.current.payloadFormat);

	let nextId = 1;

	/* Messages can arrive far faster than the UI can render. They are collected
	   into a plain array and flushed into reactive state on a timer, so a busy
	   wildcard subscription costs one re-render per frame instead of hundreds. */
	let pending: CapturedMessage[] = [];
	let flushTimer: ReturnType<typeof setInterval> | null = null;
	/** Receive timestamps within the last 10s, for the live rate readout. */
	let recent: number[] = [];
	let messageRate = $state(0);

	function onMessage(msg: StreamMessage) {
		totalReceived++;
		recent.push(msg.ts);
		if (paused) {
			skippedWhilePaused++;
			return;
		}
		pending.push({
			id: nextId++,
			topic: msg.topic,
			payload: msg.payload,
			qos: msg.qos,
			retain: msg.retain,
			dup: msg.dup,
			ts: msg.ts
		});
	}

	function flush() {
		const cutoff = Date.now() - 10_000;
		recent = recent.filter((t) => t >= cutoff);
		messageRate = recent.length / 10;

		if (pending.length === 0) return;
		const cap = Math.max(50, settings.current.monitorBuffer);
		const batch = pending;
		pending = [];
		// Newest first, so the reader never has to chase an autoscrolling list.
		messages = [...batch.reverse(), ...messages].slice(0, cap);
	}

	function start(filter: string) {
		stop();
		const next = new TopicStream([filter], onMessage);
		next.start();
		stream = next;
		activeFilter = filter;
		flushTimer = setInterval(flush, 150);
	}

	function stop() {
		stream?.stop();
		stream = null;
		activeFilter = null;
		if (flushTimer) clearInterval(flushTimer);
		flushTimer = null;
		pending = [];
	}

	function subscribe() {
		const filter = filterInput.trim();
		if (validateFilter(filter)) return;
		start(filter);
		// Keep the filter in the URL so the view is linkable and survives reload.
		const url = new URL(page.url);
		url.searchParams.set('t', filter);
		replaceState(url, {});
	}

	/**
	 * Pausing drains whatever already arrived before freezing, so the list
	 * settles at once instead of gaining another batch 150ms later — which would
	 * read as the pause not having taken.
	 */
	function togglePause() {
		if (!paused) {
			flush();
			paused = true;
		} else {
			paused = false;
		}
	}

	function clearCapture() {
		messages = [];
		pending = [];
		totalReceived = 0;
		skippedWhilePaused = 0;
		recent = [];
		messageRate = 0;
		selectedId = null;
	}

	onMount(async () => {
		const preset = page.url.searchParams.get('t');
		if (preset) filterInput = preset;
		await tick();
		// Only auto-subscribe when the page was opened with an explicit filter,
		// so landing here bare never starts capturing without being asked.
		if (preset && !validateFilter(preset)) start(preset);
	});

	onDestroy(stop);

	/* ----------------------------------------------------------------- view */

	let search = $state('');

	const visible = $derived.by(() => {
		if (!search.trim()) return messages;
		const needle = search.toLowerCase();
		return messages.filter(
			(m) =>
				m.topic.toLowerCase().includes(needle) || toText(m.payload).toLowerCase().includes(needle)
		);
	});

	const selected = $derived(messages.find((m) => m.id === selectedId) ?? null);

	const distinctTopics = $derived(new Set(messages.map((m) => m.topic)).size);
	const totalBytes = $derived(messages.reduce((sum, m) => sum + m.payload.byteLength, 0));
	const bufferFull = $derived(messages.length >= Math.max(50, settings.current.monitorBuffer));

	const rejected = $derived(stream?.rejected ?? []);

	/* --------------------------------------------------------------- export */

	function exportAs(kind: 'json' | 'ndjson' | 'csv') {
		const rows = visible.map((m) => ({
			timestamp: new Date(m.ts).toISOString(),
			received_at_ms: m.ts,
			topic: m.topic,
			qos: m.qos,
			retain: m.retain,
			dup: m.dup,
			size_bytes: m.payload.byteLength,
			payload: formatPayload(m.payload, format).text,
			payload_base64: bytesToBase64(m.payload)
		}));

		if (rows.length === 0) {
			toasts.info('Nothing to export', 'No captured messages match the current search.');
			return;
		}

		if (kind === 'csv') {
			download(
				timestampedName('rmqtt-monitor', 'csv'),
				toCsv(
					['timestamp', 'topic', 'qos', 'retain', 'dup', 'size_bytes', 'payload', 'payload_base64'],
					rows
				),
				'text/csv;charset=utf-8'
			);
		} else if (kind === 'ndjson') {
			download(
				timestampedName('rmqtt-monitor', 'ndjson'),
				rows.map((r) => JSON.stringify(r)).join('\n'),
				'application/x-ndjson'
			);
		} else {
			download(
				timestampedName('rmqtt-monitor', 'json'),
				JSON.stringify(
					{ filter: activeFilter, exported_at: new Date().toISOString(), messages: rows },
					null,
					2
				),
				'application/json'
			);
		}
		toasts.success('Exported', `${rows.length} message${rows.length === 1 ? '' : 's'}.`);
	}

	const QUICK_FILTERS = ['#', '$SYS/#', 'demo/#'];
</script>

<div class="flex flex-col gap-4">
	<!-- Subscription controls -->
	<section class="card p-3">
		<form
			class="flex flex-wrap items-end gap-3"
			onsubmit={(e) => {
				e.preventDefault();
				subscribe();
			}}
		>
			<div class="min-w-64 flex-1">
				<label class="label" for="m-filter">Topic filter</label>
				<input
					id="m-filter"
					class="input mono"
					placeholder="demo/+/temp"
					bind:value={filterInput}
					autocomplete="off"
					spellcheck="false"
					aria-invalid={filterError ? 'true' : undefined}
					aria-describedby={filterError ? 'm-filter-error' : undefined}
				/>
				{#if filterError}
					<p id="m-filter-error" class="mt-1 text-[11px]" style="color:var(--critical-ink)">
						{filterError}
					</p>
				{:else}
					<p class="mt-1 text-[11px] text-[var(--text-muted)]">
						<code class="mono">+</code> matches one level, <code class="mono">#</code> matches the rest.
					</p>
				{/if}
			</div>

			{#if activeFilter}
				<button type="button" class="btn btn-ghost" onclick={stop}>
					<Icon name="close" size={14} /> Stop
				</button>
				<button type="submit" class="btn btn-primary" disabled={Boolean(filterError)}>
					<Icon name="refresh" size={14} /> Resubscribe
				</button>
			{:else}
				<button type="submit" class="btn btn-primary" disabled={Boolean(filterError)}>
					<Icon name="monitor" size={14} /> Subscribe
				</button>
			{/if}
		</form>

		<div class="mt-2.5 flex flex-wrap items-center gap-1.5">
			<span class="text-[11px] text-[var(--text-muted)]">Quick:</span>
			{#each QUICK_FILTERS as quick (quick)}
				<button
					type="button"
					class="chip mono"
					style="background:var(--surface-3);color:var(--text-2)"
					onclick={() => (filterInput = quick)}
				>
					{quick}
				</button>
			{/each}
		</div>
	</section>

	{#if rejected.length > 0}
		<div
			class="flex items-start gap-2.5 rounded-lg border px-3.5 py-3"
			style="border-color:color-mix(in srgb, var(--warning) 40%, transparent);background:var(--warning-soft)"
			role="alert"
		>
			<span style="color:var(--warning-ink)" class="mt-0.5 shrink-0">
				<Icon name="warning" size={15} />
			</span>
			<div class="text-xs text-[var(--text-2)]">
				<p class="font-medium" style="color:var(--warning-ink)">
					The broker refused this subscription
				</p>
				{#each rejected as row (row.filter)}
					<p class="mt-0.5">
						<code class="mono">{row.filter}</code>{#if row.error}
							— {row.error}{/if}
					</p>
				{/each}
				<p class="mt-1.5">
					rmqtt's built-in ACL denies a bare <code class="mono">#</code> and
					<code class="mono">$SYS/#</code> to any client that is not on the broker's own host,
					except for the username it whitelists (<code class="mono">dashboard</code> by default).
					Subscribe to a narrower filter, or adjust
					<code class="mono">plugins/rmqtt-acl.toml</code>.
				</p>
			</div>
		</div>
	{/if}

	{#if activeFilter}
		<!-- Capture toolbar and counters -->
		<section class="card flex flex-wrap items-center gap-x-5 gap-y-3 p-3">
			<div class="flex items-center gap-2">
				<StatusChip
					tone={stream?.status === 'connected'
						? 'good'
						: stream?.status === 'error'
							? 'critical'
							: 'warning'}
					label={stream?.status === 'connected'
						? paused
							? 'Paused'
							: 'Streaming'
						: (stream?.status ?? 'connecting')}
					icon={paused ? 'pause' : undefined}
				/>
				<code class="mono text-[var(--text)]">{activeFilter}</code>
			</div>

			<dl class="flex flex-wrap gap-x-5 gap-y-1 text-[11px]">
				<div class="flex items-baseline gap-1.5">
					<dt class="text-[var(--text-muted)]">Rate</dt>
					<dd class="font-semibold text-[var(--text)] tabular-nums">{fmtRate(messageRate)}/s</dd>
				</div>
				<div class="flex items-baseline gap-1.5">
					<dt class="text-[var(--text-muted)]">Received</dt>
					<dd class="font-semibold text-[var(--text)] tabular-nums">{compact(totalReceived)}</dd>
				</div>
				<div class="flex items-baseline gap-1.5">
					<dt class="text-[var(--text-muted)]">Held</dt>
					<dd class="font-semibold text-[var(--text)] tabular-nums">{compact(messages.length)}</dd>
				</div>
				<div class="flex items-baseline gap-1.5">
					<dt class="text-[var(--text-muted)]">Topics</dt>
					<dd class="font-semibold text-[var(--text)] tabular-nums">{compact(distinctTopics)}</dd>
				</div>
				<div class="flex items-baseline gap-1.5">
					<dt class="text-[var(--text-muted)]">Payload</dt>
					<dd class="font-semibold text-[var(--text)] tabular-nums">{bytes(totalBytes)}</dd>
				</div>
			</dl>

			<div class="ml-auto flex flex-wrap items-center gap-2">
				<button
					type="button"
					class="btn {paused ? 'btn-primary' : 'btn-ghost'}"
					onclick={togglePause}
				>
					<Icon name={paused ? 'play' : 'pause'} size={13} filled={paused} />
					{paused ? 'Resume' : 'Pause'}
				</button>
				<button
					type="button"
					class="btn btn-ghost"
					onclick={clearCapture}
					disabled={messages.length === 0}
				>
					<Icon name="trash" size={13} /> Clear
				</button>
				<div class="flex rounded-md border border-[var(--border-strong)] p-0.5">
					<button
						type="button"
						class="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium whitespace-nowrap text-[var(--text-2)] hover:bg-[var(--surface-3)]"
						onclick={() => exportAs('json')}
						disabled={visible.length === 0}
					>
						<Icon name="download" size={12} /> JSON
					</button>
					<button
						type="button"
						class="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium whitespace-nowrap text-[var(--text-2)] hover:bg-[var(--surface-3)]"
						onclick={() => exportAs('ndjson')}
						disabled={visible.length === 0}
					>
						NDJSON
					</button>
					<button
						type="button"
						class="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium whitespace-nowrap text-[var(--text-2)] hover:bg-[var(--surface-3)]"
						onclick={() => exportAs('csv')}
						disabled={visible.length === 0}
					>
						CSV
					</button>
				</div>
			</div>

			{#if paused && skippedWhilePaused > 0}
				<p class="w-full text-[11px] text-[var(--text-muted)]">
					<Icon name="info" size={11} class="inline align-[-1px]" />
					{compact(skippedWhilePaused)} message{skippedWhilePaused === 1 ? '' : 's'} arrived while paused
					and were not captured. The subscription stays open.
				</p>
			{/if}
			{#if stream && stream.dropped > 0}
				<p class="w-full text-[11px]" style="color:var(--warning-ink)">
					<Icon name="warning" size={11} class="inline align-[-1px]" />
					{compact(stream.dropped)} message{stream.dropped === 1 ? '' : 's'} dropped by the server-side
					rate limit ({compact(500)}/s per tab by default — see
					<code class="mono">RMQTT_MONITOR_RATE_LIMIT</code>).
				</p>
			{/if}
			{#if bufferFull}
				<p class="w-full text-[11px] text-[var(--text-muted)]">
					<Icon name="info" size={11} class="inline align-[-1px]" />
					Holding the most recent {settings.current.monitorBuffer} messages; older ones are dropped. Change
					the buffer size in Settings.
				</p>
			{/if}
		</section>

		<!-- Stream + detail -->
		<div class="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
			<section class="card flex min-h-0 flex-col overflow-hidden">
				<header class="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
					<div class="relative flex-1">
						<span
							class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--text-muted)]"
						>
							<Icon name="search" size={13} />
						</span>
						<input
							class="input pl-8"
							placeholder="Filter captured messages by topic or payload"
							bind:value={search}
							autocomplete="off"
							aria-label="Filter captured messages"
						/>
					</div>
					<span class="shrink-0 text-[11px] text-[var(--text-muted)] tabular-nums">
						{compact(visible.length)} shown
					</span>
				</header>

				<div class="max-h-[34rem] overflow-y-auto">
					{#if visible.length === 0}
						<EmptyState
							icon="monitor"
							title={messages.length === 0 ? 'Waiting for messages' : 'No matches'}
							body={messages.length === 0
								? `Subscribed to ${activeFilter}. Anything published to a matching topic from now on appears here.`
								: 'No captured message matches that search.'}
						/>
					{:else}
						<table class="tbl">
							<caption class="sr-only">Captured messages, newest first</caption>
							<thead>
								<tr>
									<th scope="col">Time</th>
									<th scope="col">Topic</th>
									<th scope="col" class="text-right">QoS</th>
									<th scope="col" class="text-right">Size</th>
									<th scope="col">Payload</th>
								</tr>
							</thead>
							<tbody>
								{#each visible as msg (msg.id)}
									<tr
										class="cursor-pointer"
										style={msg.id === selectedId ? 'background:var(--brand-soft)' : ''}
										onclick={() => (selectedId = msg.id)}
									>
										<td class="mono whitespace-nowrap text-[var(--text-muted)]"
											>{clockMs(msg.ts)}</td
										>
										<td class="mono truncate-cell text-[var(--text)]" title={msg.topic}
											>{msg.topic}</td
										>
										<td class="num">
											{msg.qos}{#if msg.retain}<span
													class="ml-1 text-[10px]"
													style="color:var(--brand-ink)"
													title="Retained">R</span
												>{/if}{#if msg.dup}<span
													class="ml-1 text-[10px] text-[var(--text-muted)]"
													title="Duplicate">D</span
												>{/if}
										</td>
										<td class="num">{bytes(msg.payload.byteLength)}</td>
										<td class="mono truncate-cell text-[var(--text-2)]"
											>{preview(msg.payload, 90)}</td
										>
									</tr>
								{/each}
							</tbody>
						</table>
					{/if}
				</div>
			</section>

			<section class="card flex flex-col overflow-hidden">
				<header class="border-b border-[var(--border)] px-4 py-3">
					<h2 class="text-sm font-semibold text-[var(--text)]">Message detail</h2>
					<p class="mt-0.5 text-[11px] text-[var(--text-muted)]">
						{selected ? 'Selected message' : 'Select a row to inspect its payload'}
					</p>
				</header>

				<div class="flex-1 p-4">
					{#if !selected}
						<EmptyState
							icon="eye"
							title="No message selected"
							body="Click any captured message to see its full payload, formatted as JSON, text, hex or base64."
						/>
					{:else}
						<dl class="mb-3 grid grid-cols-2 gap-x-4 gap-y-2">
							<div class="col-span-2 min-w-0">
								<dt class="text-[10px] tracking-wide text-[var(--text-muted)] uppercase">Topic</dt>
								<dd class="mono break-all text-[var(--text)]">{selected.topic}</dd>
							</div>
							<div>
								<dt class="text-[10px] tracking-wide text-[var(--text-muted)] uppercase">
									Received
								</dt>
								<dd class="text-xs text-[var(--text)] tabular-nums">{stamp(selected.ts)}</dd>
							</div>
							<div>
								<dt class="text-[10px] tracking-wide text-[var(--text-muted)] uppercase">Flags</dt>
								<dd class="text-xs text-[var(--text)]">
									QoS {selected.qos}{selected.retain ? ' · retained' : ''}{selected.dup
										? ' · duplicate'
										: ''}
								</dd>
							</div>
						</dl>
						<PayloadView payload={selected.payload} bind:format maxHeight="22rem" />
					{/if}
				</div>
			</section>
		</div>
	{:else}
		<EmptyState
			icon="monitor"
			title="Not subscribed"
			body="Enter a topic filter above and subscribe. The dashboard server holds one MQTT connection to the broker and relays matching messages to this page, so the broker sees a single subscriber no matter how many tabs are open."
		/>
	{/if}
</div>
