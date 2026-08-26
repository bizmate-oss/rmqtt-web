<script lang="ts">
	import Modal from './Modal.svelte';

	interface Props {
		open: boolean;
		title: string;
		body: string;
		/** Shown in a mono block — the topic or client id being acted on. */
		subject?: string;
		confirmLabel?: string;
		danger?: boolean;
		busy?: boolean;
		onconfirm: () => void;
		oncancel: () => void;
	}

	let {
		open,
		title,
		body,
		subject,
		confirmLabel = 'Confirm',
		danger = true,
		busy = false,
		onconfirm,
		oncancel
	}: Props = $props();
</script>

<Modal {open} {title} size="sm" onclose={oncancel}>
	<p class="text-sm text-[var(--text-2)]">{body}</p>
	{#if subject}
		<div
			class="mono mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 break-all text-[var(--text)]"
		>
			{subject}
		</div>
	{/if}

	{#snippet footer()}
		<button type="button" class="btn btn-ghost" onclick={oncancel} disabled={busy}>Cancel</button>
		<button
			type="button"
			class="btn {danger ? 'btn-danger' : 'btn-primary'}"
			onclick={onconfirm}
			disabled={busy}
		>
			{busy ? 'Working…' : confirmLabel}
		</button>
	{/snippet}
</Modal>
