export type ToastKind = 'success' | 'error' | 'info';

export interface Toast {
	id: number;
	kind: ToastKind;
	message: string;
	detail?: string;
}

let nextId = 1;

class ToastStore {
	items = $state<Toast[]>([]);

	push(kind: ToastKind, message: string, detail?: string) {
		const toast: Toast = { id: nextId++, kind, message, detail };
		this.items = [...this.items, toast];
		// Errors stay longer — they usually carry a broker message worth reading.
		setTimeout(() => this.dismiss(toast.id), kind === 'error' ? 8000 : 4000);
	}

	success = (message: string, detail?: string) => this.push('success', message, detail);
	error = (message: string, detail?: string) => this.push('error', message, detail);
	info = (message: string, detail?: string) => this.push('info', message, detail);

	dismiss(id: number) {
		this.items = this.items.filter((t) => t.id !== id);
	}
}

export const toasts = new ToastStore();
