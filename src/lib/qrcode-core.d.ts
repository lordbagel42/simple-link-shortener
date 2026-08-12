/**
 * `qrcode`'s encoder, reached directly.
 *
 * The package's own entry points pull in canvas and `fs` renderers that a
 * Worker has no use for. `lib/core/qrcode.js` is pure arithmetic and ships no
 * types of its own, so the one function we call is declared here.
 */
declare module 'qrcode/lib/core/qrcode.js' {
	export type QrModules = {
		/** Edge length of the matrix, in modules. */
		size: number;
		/** `size * size` entries, row-major, 1 where the module is dark. */
		data: Uint8Array;
	};

	export type QrCode = {
		modules: QrModules;
		version: number;
		errorCorrectionLevel: unknown;
		maskPattern: number;
	};

	export function create(
		text: string,
		options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'; version?: number }
	): QrCode;
}
