/**
 * Calibration for the broker's wall clock.
 *
 * The HTTP API formats timestamps as "YYYY-MM-DD HH:mm:ss" with no timezone,
 * in whatever zone the broker process runs in — UTC for the stock container,
 * local time for a bare-metal install. Guessing wrong shifts every
 * "connected 3m ago" by hours, so the offset is measured rather than assumed:
 * GET /api/v1/brokers returns `datetime`, the broker's own current time in that
 * same format, and comparing it to the browser's clock gives the difference.
 *
 * The offset is reactive state, so every relative timestamp on screen corrects
 * itself as soon as the first broker response lands.
 */
class BrokerClock {
	/** Broker clock minus browser clock, in ms. Negative when the broker is behind. */
	offsetMs = $state(0);
	/** True once a broker response has been used to calibrate. */
	synced = $state(false);

	/** Rounded to the minute so ordinary network jitter doesn't wobble the display. */
	sync(datetime: string | null | undefined, now = Date.now()) {
		const asLocal = parseNaive(datetime);
		if (asLocal === null) return;
		this.offsetMs = Math.round((asLocal - now) / 60_000) * 60_000;
		this.synced = true;
	}
}

export const brokerClock = new BrokerClock();

/** Parses the broker's format as if the numbers were in the browser's zone. */
function parseNaive(value: string | null | undefined): number | null {
	if (!value) return null;
	const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
	if (!m) {
		const t = Date.parse(value);
		return Number.isNaN(t) ? null : t;
	}
	return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

/** A broker timestamp as a browser-local epoch, corrected for the clock offset. */
export function parseBrokerTime(value: string | null | undefined): number | null {
	const naive = parseNaive(value);
	return naive === null ? null : naive - brokerClock.offsetMs;
}
