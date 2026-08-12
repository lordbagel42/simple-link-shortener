const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const plain = new Intl.NumberFormat('en');

export function formatCount(value: number): string {
	return value >= 10_000 ? compact.format(value) : plain.format(value);
}

export function formatNumber(value: number): string {
	return plain.format(value);
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
	['year', 31_536_000_000],
	['month', 2_592_000_000],
	['week', 604_800_000],
	['day', 86_400_000],
	['hour', 3_600_000],
	['minute', 60_000],
	['second', 1000]
];

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function timeAgo(value: Date | number | string | null | undefined): string {
	if (!value) return 'never';
	const time = new Date(value).getTime();
	if (Number.isNaN(time)) return 'never';

	const diff = time - Date.now();
	for (const [unit, ms] of RELATIVE_UNITS) {
		if (Math.abs(diff) >= ms || unit === 'second') {
			return relative.format(Math.round(diff / ms), unit);
		}
	}
	return 'just now';
}

const dateTime = new Intl.DateTimeFormat('en', {
	dateStyle: 'medium',
	timeStyle: 'short'
});

export function formatDateTime(value: Date | number | string | null | undefined): string {
	if (!value) return '—';
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? '—' : dateTime.format(date);
}

const dateOnly = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const hourOnly = new Intl.DateTimeFormat('en', { hour: 'numeric' });
const monthOnly = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' });

/**
 * A bucket key from the analytics query, as a label.
 *
 * The four widths are unambiguous: `2026-08` is a month, `2026-08-09` a day or
 * the Monday of a week, and `2026-08-09T14:00` an hour.
 */
export function formatBucket(bucket: string): string {
	if (bucket.length === 7) {
		const month = new Date(`${bucket}-01T00:00:00Z`);
		return Number.isNaN(month.getTime()) ? bucket : monthOnly.format(month);
	}

	const date = new Date(bucket.length > 10 ? `${bucket}:00Z` : `${bucket}T00:00:00Z`);
	if (Number.isNaN(date.getTime())) return bucket;
	return bucket.length > 10 ? hourOnly.format(date) : dateOnly.format(date);
}

/** `https://example.com/a/very/long/path?x=1` → `example.com/a/very/long/…` */
export function prettyUrl(url: string, max = 48): string {
	let value = url.replace(/^https?:\/\//, '').replace(/^www\./, '');
	if (value.endsWith('/')) value = value.slice(0, -1);
	return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Two-letter country code → flag emoji. */
export function countryFlag(code: string | null | undefined): string {
	if (!code || code.length !== 2 || !/^[a-zA-Z]{2}$/.test(code)) return '🌐';
	return String.fromCodePoint(
		...[...code.toUpperCase()].map((char) => 0x1f1a5 + char.charCodeAt(0))
	);
}

/** A stable input for the datetime-local control. */
export function toDateTimeLocal(value: Date | number | null | undefined): string {
	if (!value) return '';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';
	const offset = date.getTimezoneOffset() * 60_000;
	return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
