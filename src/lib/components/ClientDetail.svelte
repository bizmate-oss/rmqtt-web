<script lang="ts">
	import { api, errorText } from '$lib/api/client';
	import { subQos, subShare, type ClientInfo, type SubscriptionInfo } from '$lib/types';
	import { parseBrokerTime } from '$lib/stores/brokerClock.svelte';
	import { duration, protoName, relative } from '$lib/utils/format';
	import Modal from './Modal.svelte';
	import StatusChip from './StatusChip.svelte';
	import SysEventFeed from './SysEventFeed.svelte';

	interface Props {
		client: ClientInfo | null;
		onclose: () => void;
		ondisconnect: (client: ClientInfo) => void;
	}

	let { client, onclose, ondisconnect }: Props = $props();

	let subscriptions = $state<SubscriptionInfo[]>([]);
	let subsError = $state<string | null>(null);
	let loadingSubs = $state(false);

	// Subscriptions are fetched per client rather than filtered out of the full
	// list, so this stays correct on a cluster with many thousands of them.
	$effect(() => {
		const id = client?.clientid;
		if (!id) {
			subscriptions = [];
			return;
		}
		loadingSubs = true;
		subsError = null;
		api
			.clientSubscriptions(id)
			.then((rows) => (subscriptions = rows))
			.catch((err) => (subsError = errorText(err)))
			.finally(() => (loadingSubs = false));
	});

	const fields = $derived(
		client
			? [
					['Node', String(client.node_id)],
					['Username', client.username || '—'],
					['Superuser', client.superuser ? 'yes' : 'no'],
					['Protocol', protoName(client.proto_ver)],
					['Address', `${client.ip_address}:${client.port}`],
					['Connected at', client.connected_at || '—'],
					['Disconnected at', client.connected ? '—' : client.disconnected_at || '—'],
					['Disconnect reason', client.disconnected_reason || '—'],
					['Session created', client.created_at || '—'],
					['Keepalive', `${client.keepalive}s`],
					['Clean start', client.clean_start ? 'yes' : 'no'],
					['Session present', client.session_present ? 'yes' : 'no'],
					['Session expiry', duration(client.expiry_interval)],
					['Subscriptions', String(client.subscriptions_cnt)],
					[
						'Max subscriptions',
						client.max_subscriptions === 0 ? 'unlimited' : String(client.max_subscriptions)
					],
					['Inflight', `${client.inflight} / ${client.max_inflight}`],
					['Queued', `${client.mqueue_len} / ${client.max_mqueue}`]
				]
			: []
	);
</script>

<Modal
	open={client !== null}
	title={client?.clientid ?? ''}
	description="Session detail"
	size="lg"
	{onclose}
>
	{#if client}
		<div class="flex flex-col gap-4">
			<div class="flex flex-wrap items-center gap-2">
				<StatusChip
					tone={client.connected ? 'good' : 'neutral'}
					label={client.connected ? 'Connected' : 'Offline'}
				/>
				{#if client.connected && client.connected_at}
					<span class="text-[11px] text-[var(--text-muted)]">
						since {client.connected_at} ({relative(parseBrokerTime(client.connected_at))})
					</span>
				{/if}
			</div>

			<dl class="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
				{#each fields as [label, value] (label)}
					<div class="min-w-0">
						<dt class="text-[10px] tracking-wide text-[var(--text-muted)] uppercase">{label}</dt>
						<dd class="truncate text-xs text-[var(--text)]" title={value}>{value}</dd>
					</div>
				{/each}
			</dl>

			{#if client.last_will}
				<div>
					<h3 class="mb-1.5 text-xs font-semibold text-[var(--text)]">Last will</h3>
					<div
						class="mono rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2"
					>
						<div>topic: {client.last_will.topic}</div>
						<div>qos: {client.last_will.qos} · retain: {client.last_will.retain}</div>
					</div>
				</div>
			{/if}

			<div>
				<h3 class="mb-1.5 text-xs font-semibold text-[var(--text)]">
					Subscriptions ({subscriptions.length})
				</h3>
				{#if loadingSubs}
					<p class="text-xs text-[var(--text-muted)]">Loading…</p>
				{:else if subsError}
					<p class="text-xs" style="color:var(--critical-ink)">{subsError}</p>
				{:else if subscriptions.length === 0}
					<p class="text-xs text-[var(--text-muted)]">This session holds no subscriptions.</p>
				{:else}
					<div class="overflow-x-auto rounded-md border border-[var(--border)]">
						<table class="tbl">
							<thead>
								<tr>
									<th scope="col">Topic filter</th>
									<th scope="col" class="text-right">QoS</th>
									<th scope="col">Shared group</th>
									<th scope="col" class="text-right">Node</th>
								</tr>
							</thead>
							<tbody>
								{#each subscriptions as sub (sub.topic + sub.node_id)}
									<tr>
										<td class="mono text-[var(--text)]">{sub.topic}</td>
										<td class="num">{subQos(sub)}</td>
										<td class="mono">{subShare(sub) ?? '—'}</td>
										<td class="num">{sub.node_id}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</div>

			<div>
				<h3 class="mb-1.5 text-xs font-semibold text-[var(--text)]">$SYS events for this client</h3>
				<SysEventFeed clientid={client.clientid} limit={15} />
			</div>
		</div>
	{/if}

	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={onclose}>Close</button>
		{#if client?.connected}
			<button type="button" class="btn btn-danger" onclick={() => client && ondisconnect(client)}>
				Disconnect
			</button>
		{/if}
	{/snippet}
</Modal>
