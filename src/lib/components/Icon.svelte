<script lang="ts" module>
	/**
	 * Inline 24x24 stroke icons. Kept as literal markup rather than pulled from
	 * an icon package so the bundle carries only what the dashboard actually uses.
	 */
	const ICONS = {
		overview: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
		nodes:
			'<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
		clients:
			'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
		subscriptions:
			'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
		topics: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>',
		retained:
			'<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8M10 12h4"/>',
		monitor:
			'<circle cx="12" cy="12" r="2"/><path d="M4.93 19.07a10 10 0 0 1 0-14.14M19.07 4.93a10 10 0 0 1 0 14.14M7.76 16.24a6 6 0 0 1 0-8.48M16.24 7.76a6 6 0 0 1 0 8.48"/>',
		settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
		sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
		moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
		system: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
		refresh:
			'<path d="M21 3v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 21v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>',
		pause:
			'<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
		play: '<path d="M6 3.5v17l14-8.5z"/>',
		download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
		trash:
			'<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/>',
		close: '<path d="M18 6 6 18M6 6l12 12"/>',
		search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
		chevronDown: '<path d="m6 9 6 6 6-6"/>',
		chevronRight: '<path d="m9 18 6-6-6-6"/>',
		warning:
			'<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
		good: '<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="m9 11 3 3L22 4"/>',
		critical: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/>',
		info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
		copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
		eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
		filter: '<path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z"/>',
		table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
		chart: '<path d="M3 3v18h18"/><path d="m7 14 4-4 3 3 5-6"/>',
		clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
		cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3"/>',
		memory:
			'<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 18v3M10 18v3M14 18v3M18 18v3M7 10v4M11 10v4M15 10v4"/>',
		disk: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5M3 12a9 3 0 0 0 18 0"/>',
		disconnect: '<path d="m19 5-3 3M5 19l3-3M15 3l6 6-3 3-6-6zM3 15l6 6 3-3-6-6z"/>',
		link: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
		send: '<path d="m22 2-7 20-4-9-9-4 20-7z"/>',
		plus: '<path d="M12 5v14M5 12h14"/>',
		menu: '<path d="M4 6h16M4 12h16M4 18h16"/>'
	} as const;

	export type IconName = keyof typeof ICONS;
	export { ICONS };
</script>

<script lang="ts">
	interface Props {
		name: IconName;
		size?: number;
		class?: string;
		/** Solid icons (play) need fill rather than stroke. */
		filled?: boolean;
	}

	let { name, size = 16, class: className = '', filled = false }: Props = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill={filled ? 'currentColor' : 'none'}
	stroke={filled ? 'none' : 'currentColor'}
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	class={className}
	aria-hidden="true"
	focusable="false"
>
	<!-- Constant markup from the table above — never user-supplied. -->
	{@html ICONS[name]}
</svg>
