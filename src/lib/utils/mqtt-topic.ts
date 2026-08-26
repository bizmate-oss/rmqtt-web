/**
 * MQTT topic filter matching, shared by the server-side bridge and the browser.
 *
 * Implements the MQTT 3.1.1/5 rules: `+` matches exactly one level, `#` matches
 * the remainder including zero levels (so `a/#` matches `a`), and neither
 * wildcard matches a topic whose first level starts with `$` unless the filter
 * names it explicitly.
 */
export function compileFilter(filter: string): (topic: string) => boolean {
	const parts = filter.split('/');
	const guardsDollar = !parts[0]?.startsWith('$');

	return (topic: string) => {
		const levels = topic.split('/');
		if (guardsDollar && levels[0]?.startsWith('$')) return false;

		for (let i = 0; i < parts.length; i++) {
			const p = parts[i];
			// `#` also matches zero remaining levels, so it may sit past the end.
			if (p === '#') return true;
			if (i >= levels.length) return false;
			if (p !== '+' && p !== levels[i]) return false;
		}
		return parts.length === levels.length;
	};
}

/**
 * Validates a topic filter well enough to catch the mistakes that silently
 * match nothing. Returns null when the filter is usable.
 */
export function validateFilter(value: string): string | null {
	if (!value) return 'Enter a topic filter.';
	if (value.length > 65535) return 'Topic filter is too long.';
	const levels = value.split('/');
	for (let i = 0; i < levels.length; i++) {
		const level = levels[i];
		if (level.includes('#') && level !== '#') {
			return '`#` must occupy a whole level, as in `demo/#`.';
		}
		if (level === '#' && i !== levels.length - 1) {
			return '`#` is only valid as the last level.';
		}
		if (level.includes('+') && level !== '+') {
			return '`+` must occupy a whole level, as in `demo/+/temp`.';
		}
	}
	return null;
}

export function isWildcard(topic: string): boolean {
	return topic.includes('+') || topic.includes('#');
}
