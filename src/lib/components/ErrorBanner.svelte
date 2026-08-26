<script lang="ts">
	import Icon from './Icon.svelte';

	interface Props {
		message: string;
		onretry?: () => void;
	}

	let { message, onretry }: Props = $props();
</script>

<div
	class="flex items-start gap-2.5 rounded-lg border px-3.5 py-3"
	style="border-color:color-mix(in srgb, var(--critical) 35%, transparent);background:var(--critical-soft)"
	role="alert"
>
	<span style="color:var(--critical-ink)" class="mt-0.5 shrink-0">
		<Icon name="warning" size={15} />
	</span>
	<div class="min-w-0 flex-1">
		<p class="text-sm font-medium" style="color:var(--critical-ink)">Broker request failed</p>
		<p class="mt-0.5 text-xs break-words text-[var(--text-2)]">{message}</p>
	</div>
	{#if onretry}
		<button type="button" class="btn btn-ghost btn-sm shrink-0" onclick={onretry}>
			<Icon name="refresh" size={13} /> Retry
		</button>
	{/if}
</div>
