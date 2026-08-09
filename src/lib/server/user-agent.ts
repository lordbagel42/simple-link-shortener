/**
 * Compact user-agent parser. A dependency here would sit directly on the
 * redirect hot path, so this covers the families that actually show up in
 * short-link traffic and degrades to `null` for everything else.
 */

export type ParsedUserAgent = {
	browser: string | null;
	browserVersion: string | null;
	os: string | null;
	osVersion: string | null;
	deviceType: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'other';
	deviceVendor: string | null;
	isBot: boolean;
};

type Matcher = { name: string; re: RegExp };

// Order matters: Edge claims to be Chrome, Chrome claims to be Safari, etc.
const BROWSERS: Matcher[] = [
	{ name: 'Edge', re: /Edg(?:e|A|iOS)?\/([\d.]+)/ },
	{ name: 'Opera', re: /(?:OPR|Opera)[\s/]([\d.]+)/ },
	{ name: 'Samsung Internet', re: /SamsungBrowser\/([\d.]+)/ },
	{ name: 'Vivaldi', re: /Vivaldi\/([\d.]+)/ },
	{ name: 'Brave', re: /Brave\/([\d.]+)/ },
	{ name: 'Firefox', re: /(?:Firefox|FxiOS)\/([\d.]+)/ },
	{ name: 'Chrome', re: /(?:Chrome|CriOS|Chromium)\/([\d.]+)/ },
	{ name: 'Safari', re: /Version\/([\d.]+).*Safari/ },
	{ name: 'Internet Explorer', re: /(?:MSIE |rv:)([\d.]+).*Trident/ }
];

const OSES: Matcher[] = [
	{ name: 'iPadOS', re: /iPad;.*?OS ([\d_]+)/ },
	{ name: 'iOS', re: /(?:iPhone|iPod);.*?OS ([\d_]+)/ },
	{ name: 'Android', re: /Android ([\d.]+)/ },
	{ name: 'Windows', re: /Windows NT ([\d.]+)/ },
	{ name: 'macOS', re: /Mac OS X ([\d_.]+)/ },
	{ name: 'Chrome OS', re: /CrOS \w+ ([\d.]+)/ },
	{ name: 'Ubuntu', re: /Ubuntu[/ ]?([\d.]*)/ },
	{ name: 'Linux', re: /(Linux)/ }
];

const WINDOWS_VERSIONS: Record<string, string> = {
	'10.0': '10/11',
	'6.3': '8.1',
	'6.2': '8',
	'6.1': '7'
};

const BOT_RE =
	/bot\b|crawler|spider|crawling|slurp|facebookexternalhit|facebot|preview|fetcher|monitor|curl|wget|python-requests|axios|node-fetch|go-http-client|okhttp|headless|lighthouse|pingdom|uptime|whatsapp|telegram|discord|slackbot|twitterbot|linkedinbot|embedly|quora link preview|bitlybot|skypeuripreview|applebot|petalbot|semrush|ahrefs|mj12|dotbot|bingpreview/i;

const VENDORS: Matcher[] = [
	{ name: 'Apple', re: /(iPhone|iPad|iPod|Macintosh)/ },
	{ name: 'Samsung', re: /(SM-|SAMSUNG|GT-)/ },
	{ name: 'Google', re: /(Pixel)/ },
	{ name: 'Huawei', re: /(HUAWEI|HW-)/ },
	{ name: 'Xiaomi', re: /(MI \d|Redmi|POCO)/ },
	{ name: 'OnePlus', re: /(ONEPLUS)/i }
];

export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
	const empty: ParsedUserAgent = {
		browser: null,
		browserVersion: null,
		os: null,
		osVersion: null,
		deviceType: 'other',
		deviceVendor: null,
		isBot: false
	};
	if (!ua) return empty;

	if (BOT_RE.test(ua)) {
		return { ...empty, deviceType: 'bot', isBot: true, browser: botName(ua) };
	}

	let browser: string | null = null;
	let browserVersion: string | null = null;
	for (const { name, re } of BROWSERS) {
		const match = re.exec(ua);
		if (match) {
			browser = name;
			browserVersion = match[1] ?? null;
			break;
		}
	}

	let os: string | null = null;
	let osVersion: string | null = null;
	for (const { name, re } of OSES) {
		const match = re.exec(ua);
		if (match) {
			os = name;
			osVersion = match[1] ? match[1].replace(/_/g, '.') : null;
			if (name === 'Windows' && osVersion) osVersion = WINDOWS_VERSIONS[osVersion] ?? osVersion;
			if (name === 'Linux') osVersion = null;
			break;
		}
	}

	let deviceVendor: string | null = null;
	for (const { name, re } of VENDORS) {
		if (re.test(ua)) {
			deviceVendor = name;
			break;
		}
	}

	return {
		browser,
		browserVersion,
		os,
		osVersion,
		deviceType: detectDeviceType(ua),
		deviceVendor,
		isBot: false
	};
}

function detectDeviceType(ua: string): ParsedUserAgent['deviceType'] {
	if (/iPad|Tablet|PlayBook|Silk|Android(?!.*Mobile)/.test(ua)) return 'tablet';
	if (/Mobi|iPhone|iPod|Android.*Mobile|Windows Phone|IEMobile/.test(ua)) return 'mobile';
	if (/Windows NT|Macintosh|X11|CrOS|Linux/.test(ua)) return 'desktop';
	return 'other';
}

function botName(ua: string): string {
	const named = /([A-Za-z][\w-]{2,})(?:bot|crawler|spider)/i.exec(ua);
	if (named) return `${named[1]}bot`;
	const token = /^([A-Za-z][\w-]+)/.exec(ua);
	return token ? token[1] : 'Bot';
}

/** `https://news.ycombinator.com/item?id=1` → `news.ycombinator.com` */
export function refererDomain(referer: string | null): string | null {
	if (!referer) return null;
	try {
		return new URL(referer).hostname.replace(/^www\./, '');
	} catch {
		return null;
	}
}
