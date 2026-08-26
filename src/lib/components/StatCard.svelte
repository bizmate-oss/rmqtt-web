<script lang="ts">
	import type { IconName } from './Icon.svelte';
	import type { Point } from '$lib/types';
	import Icon from './Icon.svelte';
	import Sparkline from './Sparkline.svelte';

	interface Props {
		label: string;
		value: string;
		unit?: string;
		icon?: IconName;
		/** Last-hour trend drawn under the value. */
		trend?: Point[];
		color?: string;
		footnote?: string;
		href?: string;
		loading?: boolean;
	}

	let {
		label,
		value,
		unit,
		icon,
		trend = [],
		color = 'var(--series-1)',
		footnote,
		href,
		loading = false
	}: Props = $props();
</script>

<svelte:element
	this={href ? 'a' : 'div'}
	href={href ?? undefined}
	class="card group flex flex-col gap-2 p-4 transition-colors {href
		? 'hover:border-[var(--border-strong)]'
		: ''}"
	class:opacity-60={loading}
>
	<div class="flex items-center gap-2">
		{#if icon}
			<Icon name={icon} size={14} class="text-[var(--text-muted)]" />
		{/if}
		<span class="text-xs font-medium text-[var(--text-2)]">{label}</span>
		{#if href}
			<Icon
				name="chevronRight"
				size={14}
				class="ml-auto text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100"
			/>
		{/if}
	</div>

	<div class="flex items-end justify-between gap-3">
		<div class="flex items-baseline gap-1">
			<!-- Proportional figures: a standalone stat value looks loose in tabular. -->
			<span class="text-3xl leading-none font-semibold text-[var(--text)]">{value}</span>
			{#if unit}
				<span class="text-xs font-medium text-[var(--text-muted)]">{unit}</span>
			{/if}
		</div>
		{#if trend.length > 1}
			<Sparkline points={trend} {color} width={104} height={34} />
		{/if}
	</div>

	{#if footnote}
		<div class="text-[11px] text-[var(--text-muted)]">{footnote}</div>
	{/if}
</svelte:element>
