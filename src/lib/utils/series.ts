import type { HistorySum, Point } from '$lib/types';

type HistoryPoint = { ts: number } & Record<string, number>;

/**
 * Returns the history rows oldest-first.
 *
 * rmqtt answers the history endpoints newest-first. Gauges do not care — a
 * chart positions points by timestamp, not by index — but a rate derived from
 * consecutive counter reads does: on descending input every delta is negative,
 * which reads as a counter reset and yields an empty series. Ordering is
 * normalised here rather than assumed.
 */
function ascending(history: HistorySum | undefined): HistoryPoint[] {
	const rows = (history?.data ?? []) as HistoryPoint[];
	if (rows.length < 2) return rows;
	return rows[0].ts <= rows[rows.length - 1].ts ? rows : [...rows].reverse();
}

/**
 * Reads a gauge out of a history response.
 *
 * `aliases` covers keys the broker spells differently from the documentation
 * (for example `retaineds.count` for `retained.count`).
 */
export function gaugeSeries(
	history: HistorySum | undefined,
	key: string,
	aliases: readonly string[] = []
): Point[] {
	const candidates = [key, ...aliases];
	return ascending(history)
		.map((row) => {
			const found = candidates.find((k) => typeof row[k] === 'number');
			return found === undefined ? null : { ts: row.ts, v: row[found] };
		})
		.filter((p): p is Point => p !== null);
}

/**
 * Converts a cumulative counter in a history response into a per-second rate.
 *
 * A negative delta means the counter was reset (the node restarted), which is
 * reported as 0 rather than as a large negative spike.
 */
export function rateSeries(history: HistorySum | undefined, key: string): Point[] {
	const rows = ascending(history);
	if (rows.length < 2) return [];

	const out: Point[] = [];
	for (let i = 1; i < rows.length; i++) {
		const dt = rows[i].ts - rows[i - 1].ts;
		if (dt <= 0) continue;
		const delta = (rows[i][key] ?? 0) - (rows[i - 1][key] ?? 0);
		out.push({ ts: rows[i].ts, v: delta < 0 ? 0 : (delta / dt) * 1000 });
	}
	return out;
}
