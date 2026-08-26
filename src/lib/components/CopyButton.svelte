<script lang="ts">
	import Icon from './Icon.svelte';

	interface Props {
		value: string;
		label?: string;
	}

	let { value, label = 'Copy' }: Props = $props();
	let copied = $state(false);

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			/* clipboard blocked — the value is on screen anyway */
		}
	}
</script>

<button
	type="button"
	class="btn btn-ghost btn-sm"
	onclick={copy}
	aria-label={copied ? 'Copied' : label}
>
	<Icon name={copied ? 'good' : 'copy'} size={13} />
	{copied ? 'Copied' : label}
</button>
