const COMPACT = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const FULL = new Intl.NumberFormat('en');

/** 1284 → "1,284"; 1284000 → "1.3M". Stat-tile values and axis ticks. */
export function compact(n: number | null | undefined): string {
	if (n === null || n === undefined || !Number.isFinite(n)) return '—';
	if (Math.abs(n) < 10_000) return FULL.format(Math.round(n * 100) / 100);
	return COMPACT.format(n);
}

export function full(n: number | null | undefined): string {
	if (n === null || n === undefined || !Number.isFinite(n)) return '—';
	return FULL.format(n);
}

/** Message rates: keeps decimals below 100/s so a quiet broker isn't all zeroes. */
export function rate(n: number | null | undefined): string {
	if (n === null || n === undefined || !Number.isFinite(n)) return '—';
	if (n === 0) return '0';
	if (Math.abs(n) < 1) return n.toFixed(2);
	if (Math.abs(n) < 100) return n.toFixed(1);
	return compact(n);
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function bytes(n: number | null | undefined): string {
	if (n === null || n === undefined || !Number.isFinite(n)) return '—';
	let v = n;
	let i = 0;
	while (Math.abs(v) >= 1024 && i < UNITS.length - 1) {
		v /= 1024;
		i++;
	}
	return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1)} ${UNITS[i]}`;
}

export function percent(part: number, whole: number): number {
	if (!whole || !Number.isFinite(part / whole)) return 0;
	return Math.min(100, Math.max(0, (part / whole) * 100));
}

/** Seconds → "3d 4h", "12m 30s". */
export function duration(seconds: number | null | undefined): string {
	if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
		return '—';
	}
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (d) return `${d}d ${h}h`;
	if (h) return `${h}h ${m}m`;
	if (m) return `${m}m ${s}s`;
	return `${s}s`;
}

/**
 * Condenses the broker's uptime string
 * ("5 days 23 hours, 33 minutes, 0 seconds") into "5d 23h".
 */
export function uptime(value: string | null | undefined): string {
	if (!value) return '—';
	const grab = (unit: string) => {
		const m = value.match(new RegExp(`(\\d+)\\s*${unit}`, 'i'));
		return m ? Number(m[1]) : 0;
	};
	const d = grab('day');
	const h = grab('hour');
	const m = grab('minute');
	const s = grab('second');
	if (d) return `${d}d ${h}h`;
	if (h) return `${h}h ${m}m`;
	if (m) return `${m}m ${s}s`;
	return `${s}s`;
}

const TIME = new Intl.DateTimeFormat('en-GB', {
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hour12: false
});
const HHMM = new Intl.DateTimeFormat('en-GB', {
	hour: '2-digit',
	minute: '2-digit',
	hour12: false
});
const DATETIME = new Intl.DateTimeFormat('en-GB', {
	year: 'numeric',
	month: '2-digit',
	day: '2-digit',
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit',
	hour12: false
});

export function clock(ts: number): string {
	return TIME.format(new Date(ts));
}

/** Axis ticks on the last-hour charts. */
export function hhmm(ts: number): string {
	return HHMM.format(new Date(ts));
}

export function stamp(ts: number): string {
	return DATETIME.format(new Date(ts)).replace(',', '');
}

/** Millisecond precision — the topic monitor has to order bursts. */
export function clockMs(ts: number): string {
	const d = new Date(ts);
	return `${TIME.format(d)}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

export function relative(ts: number | null): string {
	if (ts === null) return '—';
	const diff = Math.round((Date.now() - ts) / 1000);
	if (diff < 0) return 'in the future';
	if (diff < 5) return 'just now';
	if (diff < 60) return `${diff}s ago`;
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
	return `${Math.floor(diff / 86400)}d ago`;
}

const PROTO_NAMES: Record<number, string> = {
	3: 'MQTT 3.1',
	4: 'MQTT 3.1.1',
	5: 'MQTT 5.0'
};

export function protoName(v: number | null | undefined): string {
	if (v === null || v === undefined) return '—';
	return PROTO_NAMES[v] ?? `v${v}`;
}
