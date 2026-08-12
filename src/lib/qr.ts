import { create } from 'qrcode/lib/core/qrcode.js';
import { DEFAULT_QR_OPTIONS, type QrOptions } from '$lib/types';

/**
 * QR rendering.
 *
 * `qrcode` is used only for the encoder — `create()` is pure arithmetic and
 * runs anywhere, including in a Worker. The SVG is written here instead of by
 * the library's own renderer, because that one emits a fixed black-on-white
 * grid and everything interesting about a branded QR code (colours, dot shape,
 * a logo) is in the rendering.
 */

export function qrSettings(partial: Partial<QrOptions> | null | undefined): QrOptions {
	const merged = { ...DEFAULT_QR_OPTIONS, ...(partial ?? {}) };
	return {
		...merged,
		margin: clamp(merged.margin, 0, 10),
		size: clamp(merged.size, 64, 2048),
		logoScale: clamp(merged.logoScale ?? 0.22, 0.1, 0.3)
	};
}

/**
 * Modules belonging to the three finder patterns.
 *
 * They are drawn as solid frames whatever the dot style is: a finder made of
 * loose circles is the single fastest way to make a code that scanners refuse.
 */
function isFinder(row: number, column: number, size: number): boolean {
	const inCorner = (r0: number, c0: number) =>
		row >= r0 && row < r0 + 7 && column >= c0 && column < c0 + 7;
	return inCorner(0, 0) || inCorner(0, size - 7) || inCorner(size - 7, 0);
}

export function renderQrSvg(text: string, partial?: Partial<QrOptions> | null): string {
	const options = qrSettings(partial);
	const qr = create(text, { errorCorrectionLevel: options.errorCorrection });
	const size: number = qr.modules.size;
	const data: Uint8Array = qr.modules.data;

	const margin = options.margin;
	const extent = size + margin * 2;
	const at = (row: number, column: number) => data[row * size + column] === 1;

	const shapes: string[] = [];

	if (options.style === 'square') {
		// Horizontal runs collapse into one rect each, which keeps the markup an
		// order of magnitude smaller than one rect per module.
		for (let row = 0; row < size; row++) {
			let start = -1;
			for (let column = 0; column <= size; column++) {
				const filled = column < size && at(row, column);
				if (filled && start === -1) start = column;
				if (!filled && start !== -1) {
					shapes.push(
						`<rect x="${start + margin}" y="${row + margin}" width="${column - start}" height="1"/>`
					);
					start = -1;
				}
			}
		}
	} else {
		const radius = options.style === 'dots' ? 0.42 : 0.32;
		for (let row = 0; row < size; row++) {
			for (let column = 0; column < size; column++) {
				if (!at(row, column) || isFinder(row, column, size)) continue;
				const x = column + margin;
				const y = row + margin;
				shapes.push(
					options.style === 'dots'
						? `<circle cx="${(x + 0.5).toFixed(2)}" cy="${(y + 0.5).toFixed(2)}" r="${radius}"/>`
						: `<rect x="${x + 0.08}" y="${y + 0.08}" width="0.84" height="0.84" rx="${radius}"/>`
				);
			}
		}
		for (const [r0, c0] of [
			[0, 0],
			[0, size - 7],
			[size - 7, 0]
		]) {
			shapes.push(finderShape(r0 + margin, c0 + margin, options.style));
		}
	}

	const background =
		options.background === 'transparent'
			? ''
			: `<rect width="${extent}" height="${extent}" fill="${escapeAttr(options.background)}"/>`;

	const logo = options.logo ? logoShape(options.logo, extent, options.logoScale ?? 0.22, options) : '';

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" width="${options.size}" height="${options.size}" shape-rendering="crispEdges" role="img" aria-label="QR code">${background}<g fill="${escapeAttr(options.foreground)}">${shapes.join('')}</g>${logo}</svg>`;
}

/**
 * A 7×7 finder: outer ring, one-module gap, solid 3×3 centre.
 *
 * The ring is one even-odd path rather than a filled square with a
 * background-coloured square on top, so it still reads correctly when the
 * background is transparent.
 */
function finderShape(y: number, x: number, style: QrOptions['style']): string {
	const radius = style === 'square' ? 0 : 1.75;
	const ring = `${roundedRectPath(x, y, 7, radius)} ${roundedRectPath(x + 1, y + 1, 5, radius * 0.7)}`;
	return (
		`<path d="${ring}" fill-rule="evenodd"/>` +
		`<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="${(radius * 0.4).toFixed(2)}"/>`
	);
}

function roundedRectPath(x: number, y: number, side: number, radius: number): string {
	const r = Math.min(radius, side / 2);
	if (r <= 0) return `M${x} ${y}h${side}v${side}h${-side}z`;

	const arc = `a${r} ${r} 0 0 1`;
	const straight = side - r * 2;
	return [
		`M${x + r} ${y}`,
		`h${straight}`,
		`${arc} ${r} ${r}`,
		`v${straight}`,
		`${arc} ${-r} ${r}`,
		`h${-straight}`,
		`${arc} ${-r} ${-r}`,
		`v${-straight}`,
		`${arc} ${r} ${-r}`,
		'z'
	].join(' ');
}

function logoShape(logo: string, extent: number, scale: number, options: QrOptions): string {
	const side = extent * scale;
	const offset = (extent - side) / 2;
	const pad = side * 0.12;
	const plate =
		options.background === 'transparent'
			? ''
			: `<rect x="${(offset - pad).toFixed(2)}" y="${(offset - pad).toFixed(2)}" width="${(side + pad * 2).toFixed(2)}" height="${(side + pad * 2).toFixed(2)}" rx="${(side * 0.16).toFixed(2)}" fill="${escapeAttr(options.background)}"/>`;

	return `${plate}<image href="${escapeAttr(logo)}" x="${offset.toFixed(2)}" y="${offset.toFixed(2)}" width="${side.toFixed(2)}" height="${side.toFixed(2)}" preserveAspectRatio="xMidYMid meet"/>`;
}

function escapeAttr(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min;
	return Math.min(max, Math.max(min, value));
}

/* -------------------------------------------------------------------------- */
/*  Raster export                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Rasterise the SVG in the browser.
 *
 * Workers have no canvas, so PNG export is deliberately client-side only — the
 * server API serves SVG, which is the better format for print anyway.
 */
export async function svgToPngDataUrl(svg: string, size: number): Promise<string> {
	const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
	const url = URL.createObjectURL(blob);

	try {
		const image = new Image();
		image.decoding = 'sync';
		await new Promise<void>((resolve, reject) => {
			image.onload = () => resolve();
			image.onerror = () => reject(new Error('Could not rasterise the QR code.'));
			image.src = url;
		});

		const canvas = document.createElement('canvas');
		canvas.width = size;
		canvas.height = size;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Canvas is unavailable.');
		context.drawImage(image, 0, 0, size, size);
		return canvas.toDataURL('image/png');
	} finally {
		URL.revokeObjectURL(url);
	}
}
