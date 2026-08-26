<script lang="ts">
	import { toasts } from '$lib/stores/toasts.svelte';
	import Icon from './Icon.svelte';
	import type { IconName } from './Icon.svelte';

	const ICON: Record<string, IconName> = {
		success: 'good',
		error: 'critical',
		info: 'info'
	};
	const TONE: Record<string, string> = {
		success: 'var(--good-ink)',
		error: 'var(--critical-ink)',
		info: 'var(--text-2)'
	};
</script>

<div
	class="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
	aria-live="polite"
	aria-atomic="false"
>
	{#each toasts.items as toast (toast.id)}
		<div
			class="card pointer-events-auto flex items-start gap-2.5 px-3.5 py-3 shadow-[var(--shadow-pop)]"
		>
			<span style="color:{TONE[toast.kind]}" class="mt-0.5 shrink-0">
				<Icon name={ICON[toast.kind]} size={15} />
			</span>
			<div class="min-w-0 flex-1">
				<div class="text-sm font-medium text-[var(--text)]">{toast.message}</div>
				{#if toast.detail}
					<div class="mt-0.5 text-xs break-words text-[var(--text-muted)]">{toast.detail}</div>
				{/if}
			</div>
			<button
				type="button"
				class="-m-1 rounded p-1 text-[var(--text-muted)] hover:text-[var(--text)]"
				onclick={() => toasts.dismiss(toast.id)}
				aria-label="Dismiss"
			>
				<Icon name="close" size={14} />
			</button>
		</div>
	{/each}
</div>
