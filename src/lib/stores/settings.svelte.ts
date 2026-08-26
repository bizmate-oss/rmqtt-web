import { browser } from '$app/environment';
import type { PayloadFormat } from '$lib/types';

export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Settings {
	theme: ThemeChoice;
	/** How often the HTTP polling loops re-read the broker, in milliseconds. */
	refreshMs: number;
	/** `_limit` sent to the list endpoints. */
	pageSize: number;
	/** Default rendering for message payloads. */
	payloadFormat: PayloadFormat;
	/** How many messages the topic monitor keeps before dropping the oldest. */
	monitorBuffer: number;
}

const DEFAULTS: Settings = {
	theme: 'system',
	refreshMs: 5000,
	pageSize: 200,
	payloadFormat: 'auto',
	monitorBuffer: 1000
};

const KEY = 'rmqtt-web.settings';

export const REFRESH_OPTIONS = [
	{ value: 0, label: 'Off' },
	{ value: 2000, label: '2s' },
	{ value: 5000, label: '5s' },
	{ value: 10_000, label: '10s' },
	{ value: 30_000, label: '30s' },
	{ value: 60_000, label: '1m' }
];

function load(): Settings {
	if (!browser) return { ...DEFAULTS };
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return { ...DEFAULTS };
		return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
	} catch {
		return { ...DEFAULTS };
	}
}

class SettingsStore {
	current = $state<Settings>(load());

	set<K extends keyof Settings>(key: K, value: Settings[K]) {
		this.current = { ...this.current, [key]: value };
		this.#persist();
		if (key === 'theme') applyTheme(this.current.theme);
	}

	reset() {
		this.current = { ...DEFAULTS };
		this.#persist();
		applyTheme(this.current.theme);
	}

	#persist() {
		if (!browser) return;
		try {
			localStorage.setItem(KEY, JSON.stringify(this.current));
		} catch {
			/* private mode or quota — settings simply don't persist */
		}
	}
}

export const settings = new SettingsStore();

/** Toggles the `.dark` class the token stylesheet keys off. */
export function applyTheme(choice: ThemeChoice) {
	if (!browser) return;
	const dark =
		choice === 'dark' ||
		(choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
	document.documentElement.classList.toggle('dark', dark);
}

/** Keeps `system` in sync when the OS flips while the dashboard is open. */
export function watchSystemTheme(): () => void {
	if (!browser) return () => {};
	const mq = window.matchMedia('(prefers-color-scheme: dark)');
	const onChange = () => {
		if (settings.current.theme === 'system') applyTheme('system');
	};
	mq.addEventListener('change', onChange);
	return () => mq.removeEventListener('change', onChange);
}
