<script lang="ts">
	import type { Point, Series } from '$lib/types';
	import { hhmm, stamp } from '$lib/utils/format';

	interface Props {
		series: Series[];
		height?: number;
		/** Formats y-axis ticks, end labels and tooltip values. */
		format?: (v: number) => string;
		/** Window bounds. Defaults to the extent of the data. */
		from?: number;
		to?: number;
		showLegend?: boolean;
		/** Accessible summary; falls back to the series labels. */
		label?: string;
		emptyMessage?: string;
	}

	let {
		series,
		height = 220,
		format = (v: number) => String(Math.round(v * 100) / 100),
		from,
		to,
		showLegend = true,
		label,
		emptyMessage = 'No data yet'
	}: Props = $props();

	const M = { top: 10, right: 62, bottom: 24, left: 54 };

	let width = $state(720);
	let cursor = $state<number | null>(null); // hovered timestamp
	let focused = $state(false);

	const allPoints = $derived(series.flatMap((s) => s.points));
	const hasData = $derived(allPoints.length > 0);

	const xMin = $derived(from ?? Math.min(...allPoints.map((p) => p.ts), Date.now()));
	const xMax = $derived(to ?? Math.max(...allPoints.map((p) => p.ts), Date.now()));

	const plotW = $derived(Math.max(10, width - M.left - M.right));
	const plotH = $derived(Math.max(10, height - M.top - M.bottom));

	/**
	 * Axis ticks rounded to 1/2/5 x 10^n so the labels read as clean numbers.
	 *
	 * The top tick is rounded *up* past `max`: it becomes the y-scale ceiling, so
	 * a top tick below the data would draw the series outside the plot area.
	 */
	function niceTicks(max: number, count = 4): number[] {
		if (!(max > 0)) return [0, 1];
		const raw = max / count;
		const mag = 10 ** Math.floor(Math.log10(raw));
		const norm = raw / mag;
		const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
		const top = Math.ceil(max / step) * step;
		const ticks: number[] = [];
		for (let v = 0; v <= top + step / 1000; v += step) {
			ticks.push(Number(v.toPrecision(12)));
		}
		return ticks.length > 1 ? ticks : [0, step];
	}

	const dataMax = $derived(allPoints.reduce((m, p) => Math.max(m, p.v), 0));
	const yTicks = $derived(niceTicks(dataMax === 0 ? 1 : dataMax * 1.1));
	const yMax = $derived(yTicks[yTicks.length - 1] || 1);

	const xScale = $derived(
		(ts: number) => M.left + (xMax === xMin ? plotW : ((ts - xMin) / (xMax - xMin)) * plotW)
	);
	const yScale = $derived((v: number) => M.top + plotH - (v / yMax) * plotH);

	/**
	 * Splits a series wherever sampling stopped, so a polling outage shows as a
	 * gap instead of a straight line drawn across missing minutes.
	 */
	function segments(points: Point[]): Point[][] {
		if (points.length < 2) return points.length ? [points] : [];
		const deltas = points.slice(1).map((p, i) => p.ts - points[i].ts);
		const median = [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)] || 0;
		const limit = Math.max(median * 3, 15_000);

		const out: Point[][] = [];
		let run: Point[] = [points[0]];
		for (let i = 1; i < points.length; i++) {
			if (points[i].ts - points[i - 1].ts > limit) {
				out.push(run);
				run = [];
			}
			run.push(points[i]);
		}
		out.push(run);
		return out.filter((s) => s.length > 0);
	}

	function linePath(points: Point[]): string {
		return segments(points)
			.map((seg) =>
				seg.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.ts)} ${yScale(p.v)}`).join(' ')
			)
			.join(' ');
	}

	function areaPath(points: Point[]): string {
		const base = M.top + plotH;
		return segments(points)
			.filter((seg) => seg.length > 1)
			.map((seg) => {
				const top = seg.map((p) => `L${xScale(p.ts)} ${yScale(p.v)}`).join(' ');
				return `M${xScale(seg[0].ts)} ${base} ${top} L${xScale(seg[seg.length - 1].ts)} ${base} Z`;
			})
			.join(' ');
	}

	const xTicks = $derived.by(() => {
		if (!hasData || xMax === xMin) return [];
		const count = Math.max(2, Math.min(6, Math.floor(plotW / 90)));
		return Array.from({ length: count + 1 }, (_, i) => xMin + ((xMax - xMin) * i) / count);
	});

	/** Nearest point of each series to the cursor, for the crosshair readout. */
	const readout = $derived.by(() => {
		if (cursor === null) return null;
		const rows = series
			.map((s) => {
				let best: Point | undefined;
				let bestDist = Infinity;
				for (const p of s.points) {
					const d = Math.abs(p.ts - cursor!);
					if (d < bestDist) {
						bestDist = d;
						best = p;
					}
				}
				return best ? { series: s, point: best } : null;
			})
			.filter((r): r is { series: Series; point: Point } => r !== null);
		if (rows.length === 0) return null;
		// Snap the hairline to the closest actual sample rather than the raw pointer.
		const anchor = rows.reduce((a, b) =>
			Math.abs(a.point.ts - cursor!) <= Math.abs(b.point.ts - cursor!) ? a : b
		).point.ts;
		return { ts: anchor, rows };
	});

	function tsFromClientX(clientX: number, target: SVGSVGElement) {
		const rect = target.getBoundingClientRect();
		const x = Math.min(Math.max(clientX - rect.left, M.left), M.left + plotW);
		return xMin + ((x - M.left) / plotW) * (xMax - xMin);
	}

	function onPointerMove(event: PointerEvent) {
		if (!hasData) return;
		cursor = tsFromClientX(event.clientX, event.currentTarget as SVGSVGElement);
	}

	function onKeyDown(event: KeyboardEvent) {
		if (!hasData) return;
		const step = (xMax - xMin) / 40;
		if (event.key === 'ArrowLeft') {
			cursor = Math.max(xMin, (cursor ?? xMax) - step);
			event.preventDefault();
		} else if (event.key === 'ArrowRight') {
			cursor = Math.min(xMax, (cursor ?? xMin) + step);
			event.preventDefault();
		} else if (event.key === 'Escape') {
			cursor = null;
		}
	}

	const tooltipStyle = $derived.by(() => {
		if (!readout) return '';
		const x = xScale(readout.ts);
		const flip = x > M.left + plotW * 0.6;
		return flip
			? `right:${Math.max(8, width - x + 12)}px;top:${M.top}px`
			: `left:${Math.min(width - 190, x + 12)}px;top:${M.top}px`;
	});

	const ariaLabel = $derived(label ?? `Time series: ${series.map((s) => s.label).join(', ')}`);

	/**
	 * End markers, with a flag for whether the direct value label fits.
	 *
	 * When series converge at the right edge their labels overlap. Nudging them
	 * apart would detach each number from its line, so a colliding label is
	 * dropped instead and the legend, crosshair tooltip and table view carry the
	 * value. The marker itself always stays.
	 */
	const MIN_LABEL_GAP = 13;

	const endMarkers = $derived.by(() => {
		const marks = series
			.map((s) => {
				const point = s.points[s.points.length - 1];
				return point ? { series: s, point, y: yScale(point.v) } : null;
			})
			.filter((m): m is { series: Series; point: Point; y: number } => m !== null)
			.sort((a, b) => a.y - b.y);

		let lastLabelled = -Infinity;
		return marks.map((mark) => {
			const showLabel = mark.y - lastLabelled >= MIN_LABEL_GAP;
			if (showLabel) lastLabelled = mark.y;
			return { ...mark, showLabel };
		});
	});
</script>

<div class="w-full">
	{#if showLegend && series.length > 1}
		<!-- A legend is present for every multi-series chart: identity never rests
		     on color alone, which also covers the low-contrast light-mode hues. -->
		<div class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
			{#each series as s (s.key)}
				<span class="flex items-center gap-1.5 text-xs text-[var(--text-2)]">
					<span
						class="inline-block h-0.5 w-4 rounded-full"
						style="background:{s.color}"
						aria-hidden="true"
					></span>
					{s.label}
				</span>
			{/each}
		</div>
	{/if}

	<div class="relative" bind:clientWidth={width}>
		{#if !hasData}
			<div
				class="flex items-center justify-center text-xs text-[var(--text-muted)]"
				style="height:{height}px"
			>
				{emptyMessage}
			</div>
		{:else}
			<!--
				The chart is readable without any interaction: it has an accessible
				name, direct end labels, and a full table view one toggle away in
				ChartCard. The crosshair is a progressive enhancement layered on top,
				which is why the graphic keeps role="img" while still taking pointer
				and arrow-key input.
			-->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<svg
				{width}
				{height}
				role="img"
				aria-label={ariaLabel}
				tabindex="0"
				class="block touch-none outline-none"
				onpointermove={onPointerMove}
				onpointerleave={() => (cursor = null)}
				onkeydown={onKeyDown}
				onfocus={() => (focused = true)}
				onblur={() => {
					focused = false;
					cursor = null;
				}}
			>
				<!-- gridlines: hairline, solid, one step off the surface -->
				{#each yTicks as t (t)}
					<line
						x1={M.left}
						x2={M.left + plotW}
						y1={yScale(t)}
						y2={yScale(t)}
						stroke="var(--chart-grid)"
						stroke-width="1"
						shape-rendering="crispEdges"
					/>
					<text
						x={M.left - 8}
						y={yScale(t)}
						text-anchor="end"
						dominant-baseline="middle"
						font-size="10"
						fill="var(--chart-muted)"
						style="font-variant-numeric:tabular-nums"
					>
						{format(t)}
					</text>
				{/each}

				{#each xTicks as t, i (i)}
					<text
						x={xScale(t)}
						y={M.top + plotH + 15}
						text-anchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
						font-size="10"
						fill="var(--chart-muted)"
						style="font-variant-numeric:tabular-nums"
					>
						{hhmm(t)}
					</text>
				{/each}

				<line
					x1={M.left}
					x2={M.left + plotW}
					y1={M.top + plotH}
					y2={M.top + plotH}
					stroke="var(--chart-axis)"
					stroke-width="1"
					shape-rendering="crispEdges"
				/>

				{#if readout}
					<line
						x1={xScale(readout.ts)}
						x2={xScale(readout.ts)}
						y1={M.top}
						y2={M.top + plotH}
						stroke="var(--chart-axis)"
						stroke-width="1"
					/>
				{/if}

				{#each series as s (s.key)}
					{#if s.area !== false && series.length === 1}
						<path d={areaPath(s.points)} fill={s.color} fill-opacity="0.1" />
					{/if}
					<path
						d={linePath(s.points)}
						fill="none"
						stroke={s.color}
						stroke-width="2"
						stroke-linejoin="round"
						stroke-linecap="round"
					/>
				{/each}

				<!-- End markers and direct labels. Together with the legend these are
				     the relief for the sub-3:1 light-mode series colors. -->
				{#each endMarkers as mark (mark.series.key)}
					<circle
						cx={xScale(mark.point.ts)}
						cy={mark.y}
						r="4"
						fill={mark.series.color}
						stroke="var(--chart-surface)"
						stroke-width="2"
					/>
					{#if mark.showLabel}
						<text
							x={xScale(mark.point.ts) + 9}
							y={mark.y}
							dominant-baseline="middle"
							font-size="11"
							font-weight="600"
							fill="var(--text)"
							style="font-variant-numeric:tabular-nums"
						>
							{format(mark.point.v)}
						</text>
					{/if}
				{/each}

				{#if readout}
					{#each readout.rows as row (row.series.key)}
						<circle
							cx={xScale(row.point.ts)}
							cy={yScale(row.point.v)}
							r="4"
							fill={row.series.color}
							stroke="var(--chart-surface)"
							stroke-width="2"
						/>
					{/each}
				{/if}
			</svg>

			{#if readout}
				<div
					class="pointer-events-none absolute z-10 min-w-[170px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-2 shadow-[var(--shadow-pop)]"
					style={tooltipStyle}
					role="status"
				>
					<div class="mb-1 text-[11px] text-[var(--text-muted)] tabular-nums">
						{stamp(readout.ts)}
					</div>
					{#each readout.rows as row (row.series.key)}
						<div class="flex items-baseline justify-between gap-3 py-0.5">
							<span class="flex items-center gap-1.5 text-[11px] text-[var(--text-2)]">
								<span
									class="inline-block h-0.5 w-3 rounded-full"
									style="background:{row.series.color}"
									aria-hidden="true"
								></span>
								{row.series.label}
							</span>
							<span class="text-xs font-semibold text-[var(--text)] tabular-nums">
								{format(row.point.v)}
							</span>
						</div>
					{/each}
				</div>
			{/if}

			{#if focused}
				<span class="sr-only" aria-live="polite">
					{readout
						? `${stamp(readout.ts)}: ${readout.rows.map((r) => `${r.series.label} ${format(r.point.v)}`).join(', ')}`
						: 'Use the arrow keys to move along the series.'}
				</span>
			{/if}
		{/if}
	</div>
</div>
