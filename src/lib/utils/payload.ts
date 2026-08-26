import type { PayloadFormat } from '$lib/types';

export function base64ToBytes(b64: string): Uint8Array {
	if (!b64) return new Uint8Array(0);
	try {
		const bin = atob(b64);
		const out = new Uint8Array(bin.length);
		for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
		return out;
	} catch {
		return new Uint8Array(0);
	}
}

export function bytesToBase64(bytes: Uint8Array): string {
	let bin = '';
	// Chunked so a large payload cannot exceed the argument limit of fromCharCode.
	for (let i = 0; i < bytes.length; i += 0x8000) {
		bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(bin);
}

const decoder = new TextDecoder('utf-8', { fatal: false });
/** U+FFFD, emitted by the decoder wherever the bytes were not valid UTF-8. */
const REPLACEMENT = '�';

export function toText(bytes: Uint8Array): string {
	return decoder.decode(bytes);
}

export function toHex(bytes: Uint8Array, perLine = 16): string {
	const lines: string[] = [];
	for (let off = 0; off < bytes.length; off += perLine) {
		const slice = bytes.subarray(off, off + perLine);
		const hex = Array.from(slice, (b) => b.toString(16).padStart(2, '0')).join(' ');
		const ascii = Array.from(slice, (b) =>
			b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'
		).join('');
		const offset = off.toString(16).padStart(8, '0');
		lines.push(`${offset}  ${hex.padEnd(perLine * 3 - 1, ' ')}  |${ascii}|`);
	}
	return lines.join('\n');
}

/**
 * True when the bytes decode to text a person can read: valid UTF-8 with no C0
 * or C1 control characters other than tab, newline and carriage return.
 */
export function looksPrintable(bytes: Uint8Array): boolean {
	if (bytes.length === 0) return true;
	const text = decoder.decode(bytes);
	if (text.includes(REPLACEMENT)) return false;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c === 0x09 || c === 0x0a || c === 0x0d) continue;
		if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return false;
	}
	return true;
}

export function tryParseJson(bytes: Uint8Array): unknown | undefined {
	const text = toText(bytes).trim();
	if (!text) return undefined;
	const first = text[0];
	if (first !== '{' && first !== '[' && first !== '"' && !/^-?\d|^(true|false|null)$/.test(text)) {
		return undefined;
	}
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

export interface FormattedPayload {
	/** The format actually used — differs from the request when `auto` resolves it. */
	format: Exclude<PayloadFormat, 'auto'>;
	text: string;
}

/**
 * Renders a payload for display. `auto` prefers JSON, then printable text, and
 * falls back to a hex dump for binary, so a monitor pointed at an unknown topic
 * never shows mojibake.
 */
export function formatPayload(bytes: Uint8Array, format: PayloadFormat): FormattedPayload {
	switch (format) {
		case 'json': {
			const json = tryParseJson(bytes);
			return json === undefined
				? { format: 'text', text: toText(bytes) }
				: { format: 'json', text: JSON.stringify(json, null, 2) };
		}
		case 'text':
			return { format: 'text', text: toText(bytes) };
		case 'hex':
			return { format: 'hex', text: toHex(bytes) };
		case 'base64':
			return { format: 'base64', text: bytesToBase64(bytes) };
		case 'auto':
		default: {
			const json = tryParseJson(bytes);
			if (json !== undefined) return { format: 'json', text: JSON.stringify(json, null, 2) };
			if (looksPrintable(bytes)) return { format: 'text', text: toText(bytes) };
			return { format: 'hex', text: toHex(bytes) };
		}
	}
}

/** A single-line preview for table cells. */
export function preview(bytes: Uint8Array, max = 120): string {
	const { text } = formatPayload(bytes, looksPrintable(bytes) ? 'text' : 'hex');
	const flat = text.replace(/\s+/g, ' ').trim();
	return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
