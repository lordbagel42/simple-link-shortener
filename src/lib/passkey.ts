/**
 * Browser-side passkey helpers, shared by the login and settings pages.
 *
 * WebAuthn exists only in the browser, and only on a secure origin — so both
 * entry points are guarded rather than assumed. A browser that can't do
 * passkeys should see no passkey UI at all, not a button that throws.
 */

/** Whether this browser can do WebAuthn at all. */
export function passkeysSupported(): boolean {
	return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

/**
 * Whether the browser can offer saved passkeys from the sign-in fields
 * themselves — "conditional mediation", the autofill drop-down. Where it isn't
 * available the explicit button is the only route in.
 */
export async function conditionalUiAvailable(): Promise<boolean> {
	if (!passkeysSupported()) return false;
	try {
		return (await window.PublicKeyCredential.isConditionalMediationAvailable?.()) ?? false;
	} catch {
		return false;
	}
}

/**
 * Codes that mean the person dismissed the system prompt, or that a ceremony
 * was aborted to start another one. `ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY` is
 * how @simplewebauthn reports the browser's own `NotAllowedError`, which is
 * what a dismissed sheet or a timeout raises.
 */
const DISMISSED = new Set([
	'AUTH_CANCELLED',
	'REGISTRATION_CANCELLED',
	'ERROR_CEREMONY_ABORTED',
	'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY'
]);

export type PasskeyError = { code?: string; message?: string } | null | undefined;

/**
 * What to show for a failed ceremony, or `null` when there is nothing worth
 * saying — the person closed the prompt, which isn't an error.
 */
export function passkeyErrorMessage(error: PasskeyError, fallback: string): string | null {
	if (!error) return null;
	if (error.code && DISMISSED.has(error.code)) return null;
	return error.message || fallback;
}
