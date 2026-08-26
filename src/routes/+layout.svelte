<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import Sidebar from '$lib/components/Sidebar.svelte';
	import Topbar from '$lib/components/Topbar.svelte';
	import Toaster from '$lib/components/Toaster.svelte';
	import { applyTheme, settings, watchSystemTheme } from '$lib/stores/settings.svelte';
	import { cluster } from '$lib/stores/cluster.svelte';
	import { pageMeta } from '$lib/stores/pageMeta.svelte';

	let { children } = $props();

	let navOpen = $state(false);

	onMount(() => {
		applyTheme(settings.current.theme);
		const unwatch = watchSystemTheme();
		cluster.start(settings.current.refreshMs);
		return () => {
			unwatch();
			cluster.stop();
		};
	});

	// The polling cadence follows the top-bar selector without restarting the
	// $SYS subscription or discarding the collected history.
	$effect(() => {
		cluster.setInterval(settings.current.refreshMs);
	});
</script>

<svelte:head>
	<title>{pageMeta.title} · RMQTT Dashboard</title>
</svelte:head>

<div class="min-h-screen">
	<Sidebar open={navOpen} onnavigate={() => (navOpen = false)} />

	{#if navOpen}
		<button
			type="button"
			class="fixed inset-0 z-30 bg-black/30 lg:hidden"
			aria-label="Close navigation"
			onclick={() => (navOpen = false)}
		></button>
	{/if}

	<div class="lg:pl-60">
		<Topbar
			title={pageMeta.title}
			subtitle={pageMeta.subtitle}
			onmenu={() => (navOpen = !navOpen)}
		/>
		<main class="mx-auto max-w-[1600px] p-4 sm:p-6">
			{@render children()}
		</main>
	</div>
</div>

<Toaster />
