<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	interface Props {
		open: boolean;
		title: string;
		description?: string;
		size?: 'sm' | 'md' | 'lg' | 'xl';
		onclose: () => void;
		children: Snippet;
		footer?: Snippet;
	}

	let { open, title, description, size = 'md', onclose, children, footer }: Props = $props();

	const WIDTH = { sm: 'max-w-md', md: 'max-w-2xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };

	let dialog = $state<HTMLDivElement | null>(null);

	$effect(() => {
		if (!open) return;
		// Focus moves into the dialog so Escape and Tab are handled here.
		dialog?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onclose();
		};
		document.addEventListener('keydown', onKey);
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.removeEventListener('keydown', onKey);
			document.body.style.overflow = previousOverflow;
		};
	});
</script>

{#if open}
	<div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
		<button
			type="button"
			class="fixed inset-0 bg-black/40 backdrop-blur-[1px]"
			aria-label="Close dialog"
			onclick={onclose}
		></button>

		<div
			bind:this={dialog}
			role="dialog"
			aria-modal="true"
			aria-label={title}
			tabindex="-1"
			class="card relative z-10 w-full {WIDTH[size]} outline-none"
		>
			<div class="flex items-start gap-3 border-b border-[var(--border)] px-5 py-3.5">
				<div class="min-w-0 flex-1">
					<h2 class="truncate text-sm font-semibold text-[var(--text)]">{title}</h2>
					{#if description}
						<p class="mt-0.5 text-xs text-[var(--text-muted)]">{description}</p>
					{/if}
				</div>
				<button
					type="button"
					class="-m-1 rounded p-1 text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
					onclick={onclose}
					aria-label="Close"
				>
					<Icon name="close" size={16} />
				</button>
			</div>

			<div class="px-5 py-4">
				{@render children()}
			</div>

			{#if footer}
				<div
					class="flex items-center justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface-2)] px-5 py-3"
				>
					{@render footer()}
				</div>
			{/if}
		</div>
	</div>
{/if}
