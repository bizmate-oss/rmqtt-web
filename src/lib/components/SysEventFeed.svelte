<script lang="ts">
	import { cluster } from '$lib/stores/cluster.svelte';
	import { clockMs } from '$lib/utils/format';
	import type { SysEventKind } from '$lib/types';
	import EmptyState from './EmptyState.svelte';
	import Icon from './Icon.svelte';

	interface Props {
		limit?: number;
		/** Restricts the feed to one client id — used on the client detail page. */
		clientid?: string;
	}

	let { limit = 40, clientid }: Props = $props();

	const TONE: Record<SysEventKind, string> = {
		connected: 'var(--good)',
		disconnected: 'var(--critical)',
		created: 'var(--series-1)',
		terminated: 'var(--text-muted)',
		subscribed: 'var(--series-3)',
		unsubscribed: 'var(--series-4)'
	};

	const events = $derived(
		(clientid ? cluster.sysEvents.filter((e) => e.clientid === clientid) : cluster.sysEvents).slice(
			0,
			limit
		)
	);
</script>

<section class="card flex flex-col">
	<header class="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
		<div>
			<h2 class="text-sm font-semibold text-[var(--text)]">Live activity</h2>
			<p class="mt-0.5 text-[11px] text-[var(--text-muted)]">
				Client and session events from <code class="mono">$SYS/brokers/+/…</code>
			</p>
		</div>
		{#if cluster.sysEvents.length > 0}
			<button type="button" class="btn btn-ghost btn-sm" onclick={() => cluster.clearEvents()}>
				Clear
			</button>
		{/if}
	</header>

	<div class="max-h-[26rem] overflow-y-auto">
		{#if events.length === 0}
			<EmptyState
				icon="monitor"
				title={cluster.sysStatus === 'connected' ? 'Waiting for events' : 'No $SYS feed'}
				body={cluster.sysStatus === 'connected'
					? 'Connections, disconnections, subscribes and session changes appear here as the broker publishes them.'
					: 'The dashboard server is not subscribed to $SYS. Check RMQTT_MQTT_URL and that the rmqtt-sys-topic plugin is enabled.'}
			/>
		{:else}
			<ul class="divide-y divide-[var(--border)]">
				{#each events as event (event.clientid + event.kind + event.receivedAt)}
					<li class="flex items-start gap-2.5 px-4 py-2.5">
						<span
							class="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full"
							style="background:{TONE[event.kind]}"
							aria-hidden="true"
						></span>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-baseline gap-x-2">
								<span class="text-xs font-semibold text-[var(--text)]">{event.kind}</span>
								<a
									href="/clients?clientid={encodeURIComponent(event.clientid)}"
									class="mono truncate text-[var(--text-2)] hover:text-[var(--brand-ink)]"
									title={event.clientid}
								>
									{event.clientid}
								</a>
								<span class="ml-auto text-[11px] text-[var(--text-muted)] tabular-nums">
									{clockMs(event.receivedAt)}
								</span>
							</div>
							<div class="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-[var(--text-muted)]">
								<span>node {event.node}</span>
								{#if event.username}<span>user {event.username}</span>{/if}
								{#if event.ipaddress}<span class="mono">{event.ipaddress}</span>{/if}
								{#if event.topic}
									<span class="mono truncate">{event.topic}</span>
								{/if}
								{#if event.reason}<span>{event.reason}</span>{/if}
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>

	{#if cluster.sysEvents.length > limit}
		<footer
			class="flex items-center gap-1.5 border-t border-[var(--border)] px-4 py-2 text-[11px] text-[var(--text-muted)]"
		>
			<Icon name="info" size={12} />
			Showing the {limit} most recent of {cluster.sysEvents.length} buffered events.
		</footer>
	{/if}
</section>
