/** Escapes a value for RFC 4180 CSV. */
function csvCell(value: unknown): string {
	const s = value === null || value === undefined ? '' : String(value);
	return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv(columns: string[], rows: Array<Record<string, unknown>>): string {
	const head = columns.map(csvCell).join(',');
	const body = rows.map((row) => columns.map((c) => csvCell(row[c])).join(','));
	return [head, ...body].join('\r\n');
}

export function download(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
	const url = URL.createObjectURL(new Blob([content], { type: mime }));
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	// Revoked on a later tick so the download has already started.
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** e.g. `rmqtt-clients-20260825-1432.csv` */
export function timestampedName(base: string, ext: string): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, '0');
	return `${base}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
}
