import { createAuthClient } from 'better-auth/svelte';
import { passkeyClient } from '@better-auth/passkey/client';

/**
 * Browser-side auth client. Email sign-in and sign-up go through form actions
 * so they work without JS; this is used for sign-out, social redirects, and
 * passkeys — which are WebAuthn calls and can only happen in the browser.
 */
export const authClient = createAuthClient({
	plugins: [passkeyClient()]
});

export const { signIn, signOut, signUp, useSession, passkey } = authClient;
