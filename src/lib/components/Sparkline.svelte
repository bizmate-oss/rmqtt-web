<script lang="ts">
	import type { Point } from '$lib/types';

	interface Props {
		points: Point[];
		color?: string;
		height?: number;
		/** Kept in sync with the parent card width via a container query. */
		width?: number;
	}

	let { points, color = 'var(--series-1)', height = 34, width = 120 }: Props = $props();

	const path = $derived.by(() => {
		if (points.length < 2) return { line: '', area: '', dot: null as null | [number, number] };

		const xs = points.map((p) => p.ts);
		const min = Math.min(...xs);
		const max = Math.max(...xs);
		const vMax = Math.max(...points.map((p) => p.v), 0);
		const span = max - min || 1;
		// A flat series sits on the baseline rather than filling the box.
		const scale = vMax > 0 ? vMax : 1;
		const pad = 3;
		const h = height - pad * 2;

		const xy = points.map((p) => [((p.ts - min) / span) * width, pad + h - (p.v / scale) * h]);

		const line = xy.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x} ${y}`).join(' ');
		const area = `${line} L${width} ${height} L0 ${height} Z`;
		return { line, area, dot: xy[xy.length - 1] as [number, number] };
	});
</script>

{#if path.line}
	<svg {width} {height} class="block overflow-visible" aria-hidden="true">
		<path d={path.area} fill={color} fill-opacity="0.1" />
		<path
			d={path.line}
			fill="none"
			stroke={color}
			stroke-width="2"
			stroke-linejoin="round"
			stroke-linecap="round"
		/>
		{#if path.dot}
			<circle
				cx={path.dot[0]}
				cy={path.dot[1]}
				r="3"
				fill={color}
				stroke="var(--chart-surface)"
				stroke-width="2"
			/>
		{/if}
	</svg>
{:else}
	<div style="height:{height}px"></div>
{/if}
