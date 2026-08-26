<script lang="ts" generics="K extends string">
	import Icon from './Icon.svelte';

	interface Props {
		column: K;
		label: string;
		active: K;
		direction: 'asc' | 'desc';
		align?: 'left' | 'right';
		onsort: (column: K) => void;
	}

	let { column, label, active, direction, align = 'left', onsort }: Props = $props();

	const isActive = $derived(active === column);
</script>

<th
	scope="col"
	aria-sort={isActive ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
	class={align === 'right' ? 'text-right' : ''}
>
	<button
		type="button"
		class="inline-flex items-center gap-1 uppercase transition-colors hover:text-[var(--text)]"
		style={isActive ? 'color:var(--text)' : ''}
		onclick={() => onsort(column)}
	>
		{label}
		<span
			class="inline-block transition-transform"
			style={isActive && direction === 'asc' ? 'transform:rotate(180deg)' : ''}
		>
			<Icon name="chevronDown" size={11} class={isActive ? '' : 'opacity-30'} />
		</span>
	</button>
</th>
