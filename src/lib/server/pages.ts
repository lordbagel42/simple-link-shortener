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
	.error { color: #ff6166; font-size: 13px; }
	.code { margin-top: 24px; font-size: 12px; color: #4d4d4d; letter-spacing: 0.02em; }
`;

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function shell(title: string, body: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
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
