import { ApiError } from '$lib/api/client';

/**
 * A single polled read of the broker.
 *
 * Holds the previous value while a refresh is in flight so tables and charts
 * can dim rather than fall back to a skeleton — a monitoring view that blanks
 * every few seconds is unreadable.
 */
export class Resource<T> {
	data = $state<T | undefined>(undefined);
	error = $state<string | null>(null);
	loading = $state(false);
	loadedAt = $state(0);

	#fetcher: (signal: AbortSignal) => Promise<T>;
	#controller: AbortController | null = null;
	#timer: ReturnType<typeof setInterval> | null = null;
	#intervalMs = 0;

	constructor(fetcher: (signal: AbortSignal) => Promise<T>) {
		this.#fetcher = fetcher;
	}

	get hasData() {
		return this.data !== undefined;
	}

	/** True only for the very first load, when there is nothing to keep on screen. */
	get initialLoading() {
		return this.loading && !this.hasData;
	}

	async refresh(): Promise<void> {
		this.#controller?.abort();
		const controller = new AbortController();
		this.#controller = controller;
		this.loading = true;
		try {
			const value = await this.#fetcher(controller.signal);
			if (controller.signal.aborted) return;
			this.data = value;
			this.error = null;
			this.loadedAt = Date.now();
		} catch (err) {
			if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return;
			this.error =
				err instanceof ApiError || err instanceof Error ? err.message : 'Unexpected error';
		} finally {
			if (!controller.signal.aborted) this.loading = false;
		}
	}

	/** Starts (or restarts) polling. `intervalMs` of 0 loads once and stops. */
	start(intervalMs: number) {
		this.stop();
		this.#intervalMs = intervalMs;
		void this.refresh();
		if (intervalMs > 0) {
			this.#timer = setInterval(() => void this.refresh(), intervalMs);
		}
	}

	setInterval(intervalMs: number) {
		if (intervalMs === this.#intervalMs) return;
		this.start(intervalMs);
	}

	stop() {
		if (this.#timer) clearInterval(this.#timer);
		this.#timer = null;
		this.#controller?.abort();
		this.#controller = null;
		this.loading = false;
	}
}
