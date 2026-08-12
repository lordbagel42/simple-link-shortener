/**
 * Standalone HTML for the pages the redirect worker serves itself. These are
 * hand-written rather than rendered by SvelteKit so the hot path never has to
 * boot the app or load the client bundle.
 */

const SHELL_STYLES = `
	*, *::before, *::after { box-sizing: border-box; }
	:root { color-scheme: dark; }
	body {
		margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px;
		background: #0a0a0a; color: #ededed;
		font: 400 14px/1.5 ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
		-webkit-font-smoothing: antialiased;
	}
	main { width: 100%; max-width: 380px; text-align: center; }
	.mark {
		width: 36px; height: 36px; margin: 0 auto 20px; border-radius: 9px;
		display: grid; place-items: center; background: #ededed; color: #0a0a0a;
	}
	h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
	p { margin: 0; color: #a1a1a1; }
	form { margin-top: 24px; display: flex; flex-direction: column; gap: 10px; text-align: left; }
	input {
		width: 100%; height: 38px; padding: 0 12px; border-radius: 8px; color: #ededed;
		background: #0a0a0a; border: 1px solid #2e2e2e; font: inherit; outline: none;
	}
	input:focus { border-color: #4d4d4d; box-shadow: 0 0 0 3px rgba(255,255,255,0.06); }
	button {
		height: 38px; border: 0; border-radius: 8px; background: #ededed; color: #0a0a0a;
		font: 500 14px/1 inherit; cursor: pointer;
	}
	button:hover { background: #fff; }
	a.button { display: inline-block; margin-top: 20px; color: #a1a1a1; font-size: 13px; }
	.error { color: #ff6166; font-size: 13px; }
	.code { margin-top: 24px; font-size: 12px; color: #4d4d4d; letter-spacing: 0.02em; }
	.spinner {
		width: 18px; height: 18px; margin: 0 auto 20px; border-radius: 50%;
		border: 2px solid #2e2e2e; border-top-color: #ededed;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
`;

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/** For values interpolated into a `<script>` string literal. */
function escapeJs(value: string): string {
	return JSON.stringify(value).replace(/</g, '\\u003c');
}

function shell(title: string, body: string, head = ''): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
${head}
<style>${SHELL_STYLES}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

const LOCK_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`;
const LINK_ICON = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;

export function errorPage(opts: { title: string; message: string; code: number }): string {
	return shell(
		opts.title,
		`<div class="mark">${LINK_ICON}</div>
		<h1>${escapeHtml(opts.title)}</h1>
		<p>${escapeHtml(opts.message)}</p>
		<div class="code">${opts.code}</div>`
	);
}

export function passwordPage(opts: { action: string; error?: string }): string {
	return shell(
		'Password required',
		`<div class="mark">${LOCK_ICON}</div>
		<h1>This link is protected</h1>
		<p>Enter the password to continue.</p>
		<form method="post" action="${escapeHtml(opts.action)}">
			<input type="password" name="password" placeholder="Password" autocomplete="off" autofocus required>
			${opts.error ? `<span class="error">${escapeHtml(opts.error)}</span>` : ''}
			<button type="submit">Continue</button>
		</form>`
	);
}

/* -------------------------------------------------------------------------- */
/*  Cloaking                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Frames the destination so the short URL stays in the address bar.
 *
 * Plenty of sites send `X-Frame-Options: DENY` or a framing CSP, and there is
 * nothing a shortener can do about that — the frame will simply come up blank.
 * The escape hatch link at the bottom is what stops that from being a dead end.
 */
export function cloakPage(opts: {
	destination: string;
	title?: string | null;
	description?: string | null;
	image?: string | null;
}): string {
	const title = opts.title?.trim() || 'Loading…';
	const meta = [
		`<meta property="og:title" content="${escapeHtml(title)}">`,
		opts.description
			? `<meta name="description" content="${escapeHtml(opts.description)}">
<meta property="og:description" content="${escapeHtml(opts.description)}">`
			: '',
		opts.image ? `<meta property="og:image" content="${escapeHtml(opts.image)}">` : '',
		`<meta name="twitter:card" content="${opts.image ? 'summary_large_image' : 'summary'}">`,
		// The frame must not leak the short URL as its referrer either.
		`<meta name="referrer" content="no-referrer">`
	]
		.filter(Boolean)
		.join('\n');

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${meta}
<style>
	html, body { margin: 0; height: 100%; background: #0a0a0a; }
	iframe { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }
	.escape {
		position: fixed; bottom: 8px; right: 12px; z-index: 1; font: 400 11px/1 ui-sans-serif, sans-serif;
		color: rgba(255,255,255,0.45); background: rgba(0,0,0,0.45); padding: 6px 9px; border-radius: 6px;
		text-decoration: none; backdrop-filter: blur(4px);
	}
</style>
</head>
<body>
<iframe src="${escapeHtml(opts.destination)}" referrerpolicy="no-referrer"
	allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>
<a class="escape" href="${escapeHtml(opts.destination)}" target="_top" rel="noreferrer noopener">Open directly ↗</a>
</body>
</html>`;
}

/* -------------------------------------------------------------------------- */
/*  Referrer hiding                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A 302 carries the short URL as the referrer, and `Referrer-Policy` on a
 * redirect response is not honoured consistently. Bouncing through a document
 * that declares `no-referrer` and then replaces itself is the only way to be
 * sure the destination learns nothing about where the click came from.
 */
export function hiddenReferrerPage(destination: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<meta http-equiv="refresh" content="0; url=${escapeHtml(destination)}">
<title>Redirecting…</title>
<style>${SHELL_STYLES}</style>
</head>
<body><main>
	<div class="spinner"></div>
	<p>Taking you there…</p>
	<a class="button" href="${escapeHtml(destination)}" rel="noreferrer noopener">Continue</a>
</main>
<script>location.replace(${escapeJs(destination)});</script>
</body>
</html>`;
}

/* -------------------------------------------------------------------------- */
/*  Deep links                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Tries to hand the visitor off to a native app, then falls back.
 *
 * There is no way to ask a phone whether an app is installed, so this is the
 * standard shape: navigate to the app URL, and if the page is still visible
 * after a beat, the handoff did not happen — go to the fallback instead.
 */
export function deepLinkPage(opts: {
	appUrl: string;
	fallbackUrl: string;
	timeoutMs: number;
}): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Opening app…</title>
<style>${SHELL_STYLES}</style>
</head>
<body><main>
	<div class="spinner"></div>
	<h1>Opening the app</h1>
	<p>If nothing happens, we will send you to the web version.</p>
	<a class="button" href="${escapeHtml(opts.fallbackUrl)}" rel="noreferrer noopener">Continue in browser</a>
</main>
<script>
(function () {
	var app = ${escapeJs(opts.appUrl)};
	var fallback = ${escapeJs(opts.fallbackUrl)};
	var done = false;

	function give_up() {
		if (done || document.hidden) return;
		done = true;
		location.replace(fallback);
	}

	// Backgrounding the tab is the signal that the app took over.
	document.addEventListener('visibilitychange', function () {
		if (document.hidden) done = true;
	});

	setTimeout(give_up, ${Math.max(200, Math.floor(opts.timeoutMs))});
	location.replace(app);
})();
</script>
</body>
</html>`;
}
