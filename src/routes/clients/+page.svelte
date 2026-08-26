<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { api, ApiError, errorText, type ClientQuery } from '$lib/api/client';
	import ClientDetail from '$lib/components/ClientDetail.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import ErrorBanner from '$lib/components/ErrorBanner.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import SortHeader from '$lib/components/SortHeader.svelte';
	import StatusChip from '$lib/components/StatusChip.svelte';
	import { Resource } from '$lib/stores/resource.svelte';
	import { cluster } from '$lib/stores/cluster.svelte';
	import { setPageMeta } from '$lib/stores/pageMeta.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toasts } from '$lib/stores/toasts.svelte';
	import { parseBrokerTime } from '$lib/stores/brokerClock.svelte';
	import { compact, duration, protoName, relative } from '$lib/utils/format';
	import { download, timestampedName, toCsv } from '$lib/utils/download';
	import type { ClientInfo } from '$lib/types';

	setPageMeta('Clients', 'Sessions across the cluster, with connection control');

	/* ------------------------------------------------------------------ filters */

	type Connection = 'all' | 'connected' | 'offline';

	let search = $state('');
	let username = $state('');
	let ipAddress = $state('');
	let connection = $state<Connection>('all');
	let protoVer = $state<'' | '3' | '4' | '5'>('');

	/** Debounced copy of the free-text boxes, so typing doesn't hammer the broker. */
	let applied = $state({ search: '', username: '', ipAddress: '' });

	$effect(() => {
		const next = { search, username, ipAddress };
		const timer = setTimeout(() => (applied = next), 350);
		return () => clearTimeout(timer);
	});

	// Deep links from the $SYS activity feed land here with ?clientid=…
	onMount(() => {
		const preset = page.url.searchParams.get('clientid');
		if (preset) {
			search = preset;
			applied = { search: preset, username: '', ipAddress: '' };
		}
	});

	const query = $derived<ClientQuery>({
		_limit: settings.current.pageSize,
		_like_clientid: applied.search || undefined,
		_like_username: applied.username || undefined,
		ip_address: applied.ipAddress || undefined,
		connected: connection === 'all' ? undefined : connection === 'connected',
		proto_ver: protoVer ? Number(protoVer) : undefined
	});

	const hasFilters = $derived(
		Boolean(applied.search || applied.username || applied.ipAddress) ||
			connection !== 'all' ||
			protoVer !== ''
	);

	function clearFilters() {
		search = '';
		username = '';
		ipAddress = '';
		connection = 'all';
		protoVer = '';
		applied = { search: '', username: '', ipAddress: '' };
	}

	/* ------------------------------------------------------------------- data */

	const clients = new Resource<ClientInfo[]>((signal) =>
		api.clients(
			untrack(() => query),
			signal
		)
	);

	onMount(() => clients.start(settings.current.refreshMs));
	onDestroy(() => clients.stop());

	$effect(() => clients.setInterval(settings.current.refreshMs));

	// Re-read as soon as a filter changes rather than waiting for the next tick.
	$effect(() => {
		void query;
		void clients.refresh();
	});

	/* ------------------------------------------------------------------- sort */

	type Column =
		| 'clientid'
		| 'username'
		| 'node_id'
		| 'ip_address'
		| 'connected'
		| 'connected_at'
		| 'subscriptions_cnt'
		| 'mqueue_len'
		| 'inflight'
		| 'keepalive';

	let sortBy = $state<Column>('connected_at');
	let direction = $state<'asc' | 'desc'>('desc');

	function onsort(column: Column) {
		if (sortBy === column) direction = direction === 'asc' ? 'desc' : 'asc';
		else {
			sortBy = column;
			direction = 'desc';
		}
	}

	const rows = $derived.by(() => {
		const list = [...(clients.data ?? [])];
		return list.sort((a, b) => {
			const va = a[sortBy];
			const vb = b[sortBy];
			let cmp: number;
			if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb;
			else if (typeof va === 'boolean' && typeof vb === 'boolean') cmp = Number(va) - Number(vb);
			else cmp = String(va ?? '').localeCompare(String(vb ?? ''));
			return direction === 'asc' ? cmp : -cmp;
		});
	});

	const connectedCount = $derived(rows.filter((c) => c.connected).length);

	/* ---------------------------------------------------------------- actions */

	let selected = $state<Set<string>>(new Set());
	let detail = $state<ClientInfo | null>(null);
	let confirmKick = $state<ClientInfo | null>(null);
	let confirmBulk = $state(false);
	let confirmOfflines = $state(false);
	let busy = $state(false);

	const selectable = $derived(rows.filter((c) => c.connected));
	const allSelected = $derived(
		selectable.length > 0 && selectable.every((c) => selected.has(c.clientid))
	);

	function toggleAll() {
		selected = allSelected ? new Set() : new Set(selectable.map((c) => c.clientid));
	}

	function toggle(clientid: string) {
		const next = new Set(selected);
		if (next.has(clientid)) next.delete(clientid);
		else next.add(clientid);
		selected = next;
	}

	async function kick(client: ClientInfo) {
		busy = true;
		try {
			await api.kickClient(client.clientid);
			toasts.success('Client disconnected', client.clientid);
			// The session may persist (clean_start=false); re-read to show its new state.
			await clients.refresh();
		} catch (err) {
			// The broker answers 404 once the session has gone. The button's purpose
			// is already served, so this is an outcome to confirm, not an error to
			// report in red.
			if (err instanceof ApiError && err.status === 404) {
				toasts.info('Already disconnected', `${client.clientid} is no longer on the broker.`);
				await clients.refresh();
			} else {
				toasts.error('Could not disconnect', errorText(err));
			}
		} finally {
			busy = false;
			confirmKick = null;
			detail = null;
		}
	}

	async function kickSelected() {
		busy = true;
		const ids = [...selected];
		const results = await Promise.allSettled(ids.map((id) => api.kickClient(id)));

		// A 404 means that session had already gone, which is the intended end
		// state; only anything else is a real failure.
		const alreadyGone = results.filter(
			(r) => r.status === 'rejected' && r.reason instanceof ApiError && r.reason.status === 404
		).length;
		const failed = results.filter((r) => r.status === 'rejected').length - alreadyGone;
		const disconnected = ids.length - failed - alreadyGone;

		busy = false;
		confirmBulk = false;
		selected = new Set();

		const goneNote = alreadyGone > 0 ? `${alreadyGone} had already gone offline.` : undefined;
		if (failed === 0) {
			toasts.success(
				`Disconnected ${disconnected} client${disconnected === 1 ? '' : 's'}`,
				goneNote
			);
		} else {
			toasts.error(
				`Disconnected ${disconnected} of ${ids.length}`,
				[`${failed} failed.`, goneNote].filter(Boolean).join(' ')
			);
		}
		await clients.refresh();
	}

	async function cleanOfflines() {
		busy = true;
		try {
			const result = await api.kickOfflines(query);
			const count = typeof result === 'number' ? result : (result?.kicked ?? 0);
			toasts.success(
				'Offline sessions removed',
				`${count} session${count === 1 ? '' : 's'} dropped.`
			);
			await clients.refresh();
		} catch (err) {
			toasts.error('Could not remove sessions', errorText(err));
		} finally {
			busy = false;
			confirmOfflines = false;
		}
	}

	function exportCsv() {
		const columns = [
			'clientid',
			'username',
			'node_id',
			'ip_address',
			'port',
			'proto_ver',
			'connected',
			'connected_at',
			'disconnected_at',
			'disconnected_reason',
			'created_at',
			'keepalive',
			'clean_start',
			'session_present',
			'expiry_interval',
			'subscriptions_cnt',
			'inflight',
			'mqueue_len'
		];
		download(
			timestampedName('rmqtt-clients', 'csv'),
			toCsv(columns, rows as unknown as Array<Record<string, unknown>>),
			'text/csv;charset=utf-8'
		);
		toasts.success('Exported', `${rows.length} rows written to CSV.`);
	}

	const limitReached = $derived(rows.length >= (settings.current.pageSize ?? 200));
</script>

<div class="flex flex-col gap-4">
	<!-- Filters: one row, above everything they scope. -->
	<section class="card flex flex-wrap items-end gap-3 p-3">
		<div class="min-w-52 flex-1">
			<label class="label" for="f-clientid">Client ID contains</label>
			<div class="relative">
				<span
					class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-[var(--text-muted)]"
				>
					<Icon name="search" size={13} />
				</span>
				<input
					id="f-clientid"
					class="input pl-8"
					placeholder="sensor-"
					bind:value={search}
					autocomplete="off"
				/>
			</div>
		</div>

		<div class="min-w-40 flex-1">
			<label class="label" for="f-username">Username contains</label>
			<input
				id="f-username"
				class="input"
				placeholder="alice"
				bind:value={username}
				autocomplete="off"
			/>
		</div>

		<div class="min-w-36">
			<label class="label" for="f-ip">IP address</label>
			<input
				id="f-ip"
				class="input"
				placeholder="10.0.0.4"
				bind:value={ipAddress}
				autocomplete="off"
			/>
		</div>

		<div class="min-w-32">
			<label class="label" for="f-conn">Connection</label>
			<select id="f-conn" class="input" bind:value={connection}>
				<option value="all">All</option>
				<option value="connected">Connected</option>
				<option value="offline">Offline</option>
			</select>
		</div>

		<div class="min-w-32">
			<label class="label" for="f-proto">Protocol</label>
			<select id="f-proto" class="input" bind:value={protoVer}>
				<option value="">Any</option>
				<option value="3">MQTT 3.1</option>
				<option value="4">MQTT 3.1.1</option>
				<option value="5">MQTT 5.0</option>
			</select>
		</div>

		{#if hasFilters}
			<button type="button" class="btn btn-ghost" onclick={clearFilters}>
				<Icon name="close" size={13} /> Clear
			</button>
		{/if}
	</section>

	{#if clients.error}
		<ErrorBanner message={clients.error} onretry={() => clients.refresh()} />
	{/if}

	<section class="card overflow-hidden">
		<header
			class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3"
		>
			<div>
				<h2 class="text-sm font-semibold text-[var(--text)]">
					{compact(rows.length)} session{rows.length === 1 ? '' : 's'}
				</h2>
				<p class="mt-0.5 text-[11px] text-[var(--text-muted)]">
					{connectedCount} connected · {rows.length - connectedCount} offline
					{#if clients.loadedAt}· read {relative(clients.loadedAt)}{/if}
				</p>
			</div>

			<div class="flex flex-wrap items-center gap-2">
				{#if selected.size > 0}
					<span class="text-xs font-medium text-[var(--text-2)]">{selected.size} selected</span>
					<button type="button" class="btn btn-danger btn-sm" onclick={() => (confirmBulk = true)}>
						<Icon name="disconnect" size={13} /> Disconnect selected
					</button>
				{/if}
				{#if connection === 'offline' && rows.length > 0}
					<button
						type="button"
						class="btn btn-danger btn-sm"
						onclick={() => (confirmOfflines = true)}
					>
						<Icon name="trash" size={13} /> Drop offline sessions
					</button>
				{/if}
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

		<div class="overflow-x-auto" class:opacity-60={clients.initialLoading}>
			<table class="tbl">
				<caption class="sr-only">MQTT sessions on the cluster</caption>
				<thead>
					<tr>
						<th scope="col" class="w-8">
							<input
								type="checkbox"
								class="h-3.5 w-3.5 rounded border-[var(--border-strong)]"
								checked={allSelected}
								disabled={selectable.length === 0}
								onchange={toggleAll}
								aria-label="Select all connected clients"
							/>
						</th>
						<SortHeader column="clientid" label="Client ID" active={sortBy} {direction} {onsort} />
						<SortHeader column="username" label="Username" active={sortBy} {direction} {onsort} />
						<SortHeader column="connected" label="State" active={sortBy} {direction} {onsort} />
						<SortHeader
							column="node_id"
							label="Node"
							align="right"
							active={sortBy}
							{direction}
							{onsort}
						/>
						<SortHeader column="ip_address" label="Address" active={sortBy} {direction} {onsort} />
						<th scope="col">Proto</th>
						<SortHeader
							column="connected_at"
							label="Connected"
							active={sortBy}
							{direction}
							{onsort}
						/>
						<SortHeader
							column="subscriptions_cnt"
							label="Subs"
							align="right"
							active={sortBy}
							{direction}
							{onsort}
						/>
						<SortHeader
							column="inflight"
							label="Inflight"
							align="right"
							active={sortBy}
							{direction}
							{onsort}
						/>
						<SortHeader
							column="mqueue_len"
							label="Queued"
							align="right"
							active={sortBy}
							{direction}
							{onsort}
						/>
						<SortHeader
							column="keepalive"
							label="Keepalive"
							align="right"
							active={sortBy}
							{direction}
							{onsort}
						/>
						<th scope="col" class="sticky-actions text-right">Actions</th>
					</tr>
				</thead>
				<tbody>
					{#each rows as client (client.clientid + client.node_id)}
						<tr>
							<td>
								<input
									type="checkbox"
									class="h-3.5 w-3.5 rounded border-[var(--border-strong)]"
									checked={selected.has(client.clientid)}
									disabled={!client.connected}
									onchange={() => toggle(client.clientid)}
									aria-label="Select {client.clientid}"
								/>
							</td>
							<td>
								<button
									type="button"
									class="mono max-w-64 truncate text-left font-medium text-[var(--text)] hover:text-[var(--brand-ink)]"
									title={client.clientid}
									onclick={() => (detail = client)}
								>
									{client.clientid}
								</button>
								{#if client.clientid === cluster.bridgeClientId}
									<span
										class="chip ml-1.5 align-middle"
										style="background:var(--surface-3);color:var(--text-muted)"
										title="This dashboard's own $SYS connection"
									>
										this dashboard
									</span>
								{/if}
							</td>
							<td class="truncate-cell">{client.username || '—'}</td>
							<td>
								<StatusChip
									tone={client.connected ? 'good' : 'neutral'}
									label={client.connected ? 'Connected' : 'Offline'}
								/>
							</td>
							<td class="num">{client.node_id}</td>
							<td class="mono whitespace-nowrap">{client.ip_address}:{client.port}</td>
							<td class="whitespace-nowrap">{protoName(client.proto_ver)}</td>
							<td class="whitespace-nowrap tabular-nums" title={client.connected_at}>
								{client.connected
									? relative(parseBrokerTime(client.connected_at))
									: client.disconnected_at
										? `left ${relative(parseBrokerTime(client.disconnected_at))}`
										: '—'}
							</td>
							<td class="num">{client.subscriptions_cnt}</td>
							<td class="num">{client.inflight}</td>
							<td class="num" class:font-semibold={client.mqueue_len > 0}>{client.mqueue_len}</td>
							<td class="num">{duration(client.keepalive)}</td>
							<td class="sticky-actions text-right whitespace-nowrap">
								<button
									type="button"
									class="btn btn-ghost btn-sm"
									onclick={() => (detail = client)}
								>
									<Icon name="eye" size={12} /> View
								</button>
								<button
									type="button"
									class="btn btn-danger btn-sm"
									disabled={!client.connected}
									title={client.connected
										? 'Terminate this connection'
										: 'This session is already offline'}
									onclick={() => (confirmKick = client)}
								>
									<Icon name="disconnect" size={12} /> Disconnect
								</button>
							</td>
						</tr>
					{:else}
						<tr>
							<td colspan="13" class="px-4 py-10 text-center text-xs text-[var(--text-muted)]">
								{clients.initialLoading
									? 'Reading sessions…'
									: hasFilters
										? 'No sessions match these filters.'
										: 'No sessions on the cluster.'}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if limitReached}
			<footer
				class="flex items-center gap-1.5 border-t border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-[11px] text-[var(--text-muted)]"
			>
				<Icon name="info" size={12} />
				Showing the first {settings.current.pageSize} rows — the broker's
				<code class="mono">_limit</code>. Narrow the filters, or raise the page size in Settings, to
				see the rest.
			</footer>
		{/if}
	</section>
</div>

<ClientDetail
	client={detail}
	onclose={() => (detail = null)}
	ondisconnect={(c) => (confirmKick = c)}
/>

<ConfirmDialog
	open={confirmKick !== null}
	title="Disconnect client"
	body="The broker will terminate this connection. A client with automatic reconnection will come straight back, and a session with clean_start=false keeps its subscriptions and queue."
	subject={confirmKick?.clientid}
	confirmLabel="Disconnect"
	{busy}
	onconfirm={() => confirmKick && kick(confirmKick)}
	oncancel={() => (confirmKick = null)}
/>

<ConfirmDialog
	open={confirmBulk}
	title="Disconnect {selected.size} clients"
	body="Every selected connection will be terminated. Clients that reconnect automatically will return within their retry interval."
	confirmLabel="Disconnect all"
	{busy}
	onconfirm={kickSelected}
	oncancel={() => (confirmBulk = false)}
/>

<ConfirmDialog
	open={confirmOfflines}
	title="Drop offline sessions"
	body="This removes every offline session matching the current filters, discarding its queued messages and subscriptions. Connected clients are not affected."
	confirmLabel="Drop sessions"
	{busy}
	onconfirm={cleanOfflines}
	oncancel={() => (confirmOfflines = false)}
/>
