<script lang="ts">
	import Icon from './Icon.svelte';
	import LiveIndicator from './LiveIndicator.svelte';
	import { cluster } from '$lib/stores/cluster.svelte';
	import { REFRESH_OPTIONS, settings } from '$lib/stores/settings.svelte';
	import { relative } from '$lib/utils/format';

	interface Props {
		title: string;
		subtitle?: string;
		onmenu: () => void;
	}

	let { title, subtitle, onmenu }: Props = $props();

	const nodesUp = $derived(cluster.runningNodes);
	const nodesTotal = $derived(cluster.nodes.length);

	const themeIcon = $derived(
		settings.current.theme === 'dark'
			? 'moon'
			: settings.current.theme === 'light'
				? 'sun'
				: 'system'
	) as 'moon' | 'sun' | 'system';

	function cycleTheme() {
		const order = ['system', 'light', 'dark'] as const;
		const next = order[(order.indexOf(settings.current.theme) + 1) % order.length];
		settings.set('theme', next);
	}
</script>

<header
	class="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)]/95 px-4 backdrop-blur"
>
	<button
		type="button"
		class="btn btn-ghost btn-sm lg:hidden"
		onclick={onmenu}
		aria-label="Open navigation"
	>
		<Icon name="menu" size={16} />
	</button>

	<div class="min-w-0 flex-1">
		<h1 class="truncate text-sm font-semibold text-[var(--text)]">{title}</h1>
		{#if subtitle}
			<p class="truncate text-[11px] text-[var(--text-muted)]">{subtitle}</p>
		{/if}
	</div>

	<div class="flex items-center gap-2.5">
		{#if nodesTotal > 0}
			<span
				class="hidden items-center gap-1.5 text-[11px] font-medium text-[var(--text-2)] sm:flex"
				title="Nodes reporting `running: true` out of all nodes in the cluster"
			>
				<span
					class="inline-block h-1.5 w-1.5 rounded-full"
					style="background:{nodesUp === nodesTotal ? 'var(--good)' : 'var(--critical)'}"
					aria-hidden="true"
				></span>
				{nodesUp}/{nodesTotal} nodes
			</span>
		{/if}

		<LiveIndicator />

		<label class="sr-only" for="refresh-interval">Refresh interval</label>
		<select
			id="refresh-interval"
			class="input h-8 w-auto py-0 pr-7 pl-2 text-xs"
			value={settings.current.refreshMs}
			onchange={(e) => settings.set('refreshMs', Number(e.currentTarget.value))}
			title="How often the dashboard re-reads the HTTP API"
		>
			{#each REFRESH_OPTIONS as opt (opt.value)}
				<option value={opt.value}>{opt.label}</option>
			{/each}
		</select>

		<button
			type="button"
			class="btn btn-ghost btn-sm"
			onclick={() => cluster.refresh()}
			title={cluster.loadedAt ? `Last read ${relative(cluster.loadedAt)}` : 'Refresh now'}
			aria-label="Refresh now"
		>
			<Icon name="refresh" size={14} class={cluster.loading ? 'animate-spin' : ''} />
		</button>

		<button
			type="button"
			class="btn btn-ghost btn-sm"
			onclick={cycleTheme}
			aria-label="Theme: {settings.current.theme}"
			title="Theme: {settings.current.theme}"
		>
			<Icon name={themeIcon} size={14} />
		</button>
	</div>
</header>
