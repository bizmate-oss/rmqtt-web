<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import type { IconName } from './Icon.svelte';

	interface Props {
		icon?: IconName;
		title: string;
		body?: string;
		action?: Snippet;
	}

	let { icon = 'info', title, body, action }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
	<span class="text-[var(--text-muted)] opacity-60"><Icon name={icon} size={26} /></span>
	<p class="text-sm font-medium text-[var(--text)]">{title}</p>
	{#if body}
		<p class="max-w-md text-xs text-[var(--text-muted)]">{body}</p>
	{/if}
	{#if action}
		<div class="mt-2">{@render action()}</div>
	{/if}
</div>
