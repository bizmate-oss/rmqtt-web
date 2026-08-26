<script lang="ts">
	import { cluster } from '$lib/stores/cluster.svelte';
	import { relative } from '$lib/utils/format';

	/**
	 * State of the $SYS feed. The dashboard keeps working without it — the HTTP
	 * API still answers — so this reads as an enhancement, not an error.
	 */
	const TONE: Record<string, string> = {
		connected: 'var(--good)',
		connecting: 'var(--warning)',
		reconnecting: 'var(--warning)',
		error: 'var(--critical)',
		disabled: 'var(--text-muted)'
	};

	const TEXT: Record<string, string> = {
		connected: '$SYS live',
		connecting: '$SYS connecting',
		reconnecting: '$SYS reconnecting',
		error: '$SYS error',
		disabled: '$SYS off'
	};

	const title = $derived(
		cluster.sysStatus === 'connected'
			? cluster.lastSysAt
				? `Last $SYS publication ${relative(cluster.lastSysAt)}`
				: 'Subscribed to $SYS/#, waiting for the first publication'
			: (cluster.sysDetail ?? 'MQTT bridge state')
	);
</script>

<span
	class="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-2)]"
	{title}
	aria-label={`${TEXT[cluster.sysStatus]}. ${title}`}
>
	<span
		class="inline-block h-1.5 w-1.5 rounded-full"
		class:animate-pulse={cluster.sysStatus === 'connecting' || cluster.sysStatus === 'reconnecting'}
		style="background:{TONE[cluster.sysStatus]}"
		aria-hidden="true"
	></span>
	<span class="hidden sm:inline">{TEXT[cluster.sysStatus]}</span>
</span>
