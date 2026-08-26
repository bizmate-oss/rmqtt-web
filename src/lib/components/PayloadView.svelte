<script lang="ts">
	import type { PayloadFormat } from '$lib/types';
	import { bytes as fmtBytes } from '$lib/utils/format';
	import { formatPayload } from '$lib/utils/payload';
	import CopyButton from './CopyButton.svelte';

	interface Props {
		payload: Uint8Array;
		format?: PayloadFormat;
		maxHeight?: string;
		showToolbar?: boolean;
	}

	let {
		payload,
		format = $bindable('auto' as PayloadFormat),
		maxHeight = '18rem',
		showToolbar = true
	}: Props = $props();

	const FORMATS: PayloadFormat[] = ['auto', 'json', 'text', 'hex', 'base64'];
	const rendered = $derived(formatPayload(payload, format));
</script>

<div class="flex flex-col gap-2">
	{#if showToolbar}
		<div class="flex flex-wrap items-center gap-2">
			<div class="flex rounded-md border border-[var(--border-strong)] p-0.5">
				{#each FORMATS as f (f)}
					<button
						type="button"
						class="rounded px-2 py-0.5 text-[11px] font-medium capitalize"
						style={format === f
							? 'background:var(--surface-3);color:var(--text)'
							: 'color:var(--text-muted)'}
						aria-pressed={format === f}
						onclick={() => (format = f)}
					>
						{f}
					</button>
				{/each}
			</div>
			<span class="text-[11px] text-[var(--text-muted)]">
				{fmtBytes(payload.byteLength)}
				{#if format === 'auto'}· shown as {rendered.format}{/if}
			</span>
			<div class="ml-auto"><CopyButton value={rendered.text} /></div>
		</div>
	{/if}

	{#if payload.byteLength === 0}
		<p class="text-xs text-[var(--text-muted)] italic">Empty payload (zero bytes)</p>
	{:else}
		<pre
			class="mono overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 leading-relaxed whitespace-pre text-[var(--text)]"
			style="max-height:{maxHeight}">{rendered.text}</pre>
	{/if}
</div>
