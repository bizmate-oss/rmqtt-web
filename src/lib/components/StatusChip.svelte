<script lang="ts">
	import Icon from './Icon.svelte';
	import type { IconName } from './Icon.svelte';

	type Tone = 'good' | 'warning' | 'critical' | 'neutral' | 'info';

	interface Props {
		tone: Tone;
		label: string;
		/** Status colour never carries meaning alone — an icon ships with it. */
		icon?: IconName;
	}

	let { tone, label, icon }: Props = $props();

	const ICON_FOR: Record<Tone, IconName> = {
		good: 'good',
		warning: 'warning',
		critical: 'critical',
		info: 'info',
		neutral: 'info'
	};

	const STYLE: Record<Tone, string> = {
		good: 'background:var(--good-soft);color:var(--good-ink)',
		warning: 'background:var(--warning-soft);color:var(--warning-ink)',
		critical: 'background:var(--critical-soft);color:var(--critical-ink)',
		info: 'background:var(--surface-3);color:var(--text-2)',
		neutral: 'background:var(--surface-3);color:var(--text-muted)'
	};
</script>

<span class="chip" style={STYLE[tone]}>
	<Icon name={icon ?? ICON_FOR[tone]} size={11} />
	{label}
</span>
