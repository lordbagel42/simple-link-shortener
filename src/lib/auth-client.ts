import { createAuthClient } from 'better-auth/svelte';

/**
 * Browser-side auth client. Sign-in and sign-up go through form actions so they
 * work without JS; this is used for sign-out and social redirects.
 */
export const authClient = createAuthClient();

export const { signIn, signOut, signUp, useSession } = authClient;
