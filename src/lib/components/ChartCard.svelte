<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Series } from '$lib/types';
	import Icon from './Icon.svelte';
	import TimeSeriesChart from './TimeSeriesChart.svelte';
	import { hhmm } from '$lib/utils/format';

	interface Props {
		title: string;
		subtitle?: string;
		series: Series[];
		height?: number;
		format?: (v: number) => string;
		from?: number;
		to?: number;
		emptyMessage?: string;
		actions?: Snippet;
	}

	let {
		title,
		subtitle,
		series,
		height = 220,
		format = (v: number) => String(Math.round(v * 100) / 100),
		from,
		to,
		emptyMessage,
		actions
	}: Props = $props();

	// The table view is the documented relief for the light-mode series colours
	// that sit below 3:1 against the surface — every value stays reachable
	// without relying on hue or on hovering.
	let view = $state<'chart' | 'table'>('chart');

	function summarise(s: Series) {
		if (s.points.length === 0) return null;
		const values = s.points.map((p) => p.v);
		return {
			last: values[values.length - 1],
			min: Math.min(...values),
			max: Math.max(...values),
			avg: values.reduce((a, b) => a + b, 0) / values.length
		};
	}

	/** Last dozen samples, newest first — enough to read a trend without a wall of rows. */
	const recent = $derived.by(() => {
		const stamps = new Set<number>();
		for (const s of series) for (const p of s.points.slice(-12)) stamps.add(p.ts);
		return [...stamps].sort((a, b) => b - a).slice(0, 12);
	});

	function valueAt(s: Series, ts: number): number | undefined {
		let best: number | undefined;
		let bestDist = Infinity;
		for (const p of s.points) {
			const d = Math.abs(p.ts - ts);
			if (d < bestDist) {
				bestDist = d;
				best = p.v;
			}
		}
		return bestDist <= 30_000 ? best : undefined;
	}
</script>

<section class="card p-4">
	<header class="mb-3 flex flex-wrap items-start justify-between gap-2">
		<div>
			<h2 class="text-sm font-semibold text-[var(--text)]">{title}</h2>
			{#if subtitle}
				<p class="mt-0.5 text-xs text-[var(--text-muted)]">{subtitle}</p>
			{/if}
		</div>
		<div class="flex items-center gap-1.5">
			{#if actions}{@render actions()}{/if}
			<div class="flex rounded-md border border-[var(--border-strong)] p-0.5">
				<button
					type="button"
					class="rounded px-1.5 py-1"
					style={view === 'chart'
						? 'background:var(--surface-3);color:var(--text)'
						: 'color:var(--text-muted)'}
					aria-pressed={view === 'chart'}
					aria-label="Chart view"
					onclick={() => (view = 'chart')}
				>
					<Icon name="chart" size={13} />
				</button>
				<button
					type="button"
					class="rounded px-1.5 py-1"
					style={view === 'table'
						? 'background:var(--surface-3);color:var(--text)'
						: 'color:var(--text-muted)'}
					aria-pressed={view === 'table'}
					aria-label="Table view"
					onclick={() => (view = 'table')}
				>
					<Icon name="table" size={13} />
				</button>
			</div>
		</div>
	</header>

	{#if view === 'chart'}
		<TimeSeriesChart {series} {height} {format} {from} {to} label={title} {emptyMessage} />
	{:else}
		<div class="overflow-x-auto">
			<table class="tbl">
				<caption class="sr-only">{title} — summary per series</caption>
				<thead>
					<tr>
						<th scope="col">Series</th>
						<th scope="col" class="text-right">Last</th>
						<th scope="col" class="text-right">Min</th>
						<th scope="col" class="text-right">Max</th>
						<th scope="col" class="text-right">Avg</th>
					</tr>
				</thead>
				<tbody>
					{#each series as s (s.key)}
						{@const stat = summarise(s)}
						<tr>
							<td>
								<span class="flex items-center gap-1.5">
									<span
										class="inline-block h-0.5 w-4 rounded-full"
										style="background:{s.color}"
										aria-hidden="true"
									></span>
									{s.label}
								</span>
							</td>
							<td class="num">{stat ? format(stat.last) : '—'}</td>
							<td class="num">{stat ? format(stat.min) : '—'}</td>
							<td class="num">{stat ? format(stat.max) : '—'}</td>
							<td class="num">{stat ? format(stat.avg) : '—'}</td>
						</tr>
					{/each}
				</tbody>
			</table>

			{#if recent.length > 0}
				<table class="tbl mt-4">
					<caption class="sr-only">{title} — most recent samples</caption>
					<thead>
						<tr>
							<th scope="col">Time</th>
							{#each series as s (s.key)}
								<th scope="col" class="text-right">{s.label}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each recent as ts (ts)}
							<tr>
								<td class="tabular-nums">{hhmm(ts)}</td>
								{#each series as s (s.key)}
									{@const v = valueAt(s, ts)}
									<td class="num">{v === undefined ? '—' : format(v)}</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>
	{/if}
</section>
