<script lang="ts">
	import { page } from '$app/state';
	import Icon from './Icon.svelte';
	import type { IconName } from './Icon.svelte';
	import { cluster } from '$lib/stores/cluster.svelte';

	interface Props {
		open: boolean;
		onnavigate: () => void;
	}

	let { open, onnavigate }: Props = $props();

	interface NavItem {
		href: string;
		label: string;
		icon: IconName;
		count?: () => number | undefined;
	}

	const NAV: NavItem[] = [
		{ href: '/', label: 'Overview', icon: 'overview' },
		{ href: '/nodes', label: 'Nodes', icon: 'nodes', count: () => cluster.nodes.length },
		{
			href: '/clients',
			label: 'Clients',
			icon: 'clients',
			count: () => cluster.stat('connections.count')
		},
		{
			href: '/subscriptions',
			label: 'Subscriptions',
			icon: 'subscriptions',
			count: () => cluster.stat('subscriptions.count')
		},
		{ href: '/topics', label: 'Topics', icon: 'topics', count: () => cluster.stat('topics.count') },
		{
			href: '/retained',
			label: 'Retained',
			icon: 'retained',
			count: () => cluster.stat('retained.count')
		}
	];

	function isActive(href: string): boolean {
		return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	}
</script>

<aside
	class="fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-transform duration-200 lg:translate-x-0"
	class:translate-x-0={open}
	class:-translate-x-full={!open}
>
	<div class="flex h-14 items-center gap-2.5 border-b border-[var(--border)] px-4">
		<span
			class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-white"
			style="background:var(--brand)"
		>
			<Icon name="overview" size={15} />
		</span>
		<div class="min-w-0">
			<div class="truncate text-sm font-semibold text-[var(--text)]">RMQTT</div>
			<div class="truncate text-[10px] tracking-wide text-[var(--text-muted)] uppercase">
				Cluster dashboard
			</div>
		</div>
	</div>

	<nav class="flex-1 overflow-y-auto p-2.5" aria-label="Main">
		<ul class="flex flex-col gap-0.5">
			{#each NAV as item (item.href)}
				{@const active = isActive(item.href)}
				<li>
					<a
						href={item.href}
						onclick={onnavigate}
						aria-current={active ? 'page' : undefined}
						class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors"
						style={active
							? 'background:var(--brand-soft);color:var(--brand-ink);font-weight:600'
							: 'color:var(--text-2)'}
					>
						<Icon name={item.icon} size={16} />
						<span class="flex-1">{item.label}</span>
						{#if item.count}
							{@const n = item.count()}
							{#if n !== undefined && n > 0}
								<span class="text-[11px] tabular-nums opacity-70">{n}</span>
							{/if}
						{/if}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<div class="border-t border-[var(--border)] p-2.5">
		<a
			href="/settings"
			onclick={onnavigate}
			aria-current={isActive('/settings') ? 'page' : undefined}
			class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors"
			style={isActive('/settings')
				? 'background:var(--brand-soft);color:var(--brand-ink);font-weight:600'
				: 'color:var(--text-2)'}
		>
			<Icon name="settings" size={16} />
			Settings
		</a>
	</div>
</aside>
