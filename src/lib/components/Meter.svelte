<script lang="ts">
	interface Props {
		value: number;
		max: number;
		label?: string;
		/** Percentages at which the fill turns warning / critical. */
		thresholds?: [number, number];
	}

	let { value, max, label, thresholds = [75, 90] }: Props = $props();

	const pct = $derived(max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0);
	// The fill carries severity; the track is a lighter step of the same idea.
	const color = $derived(
		pct >= thresholds[1]
			? 'var(--critical)'
			: pct >= thresholds[0]
				? 'var(--warning)'
				: 'var(--brand)'
	);
</script>

<div class="flex items-center gap-2">
	<div
		class="h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-[var(--surface-3)]"
		role="meter"
		aria-valuenow={Math.round(pct)}
		aria-valuemin={0}
		aria-valuemax={100}
		aria-label={label ?? 'usage'}
	>
		<div
			class="h-full rounded-full transition-[width]"
			style="width:{pct}%;background:{color}"
		></div>
	</div>
	<span class="w-10 shrink-0 text-right text-[11px] text-[var(--text-2)] tabular-nums">
		{pct.toFixed(0)}%
	</span>
</div>
