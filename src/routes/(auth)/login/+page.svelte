<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { Fingerprint } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { signIn } from '$lib/auth-client';
	import { conditionalUiAvailable, passkeyErrorMessage, passkeysSupported } from '$lib/passkey';
	import SocialButtons from '$lib/components/app/social-buttons.svelte';

	let { data, form } = $props();
	let submitting = $state(false);

	let passkeys = $state(false);
	let passkeyBusy = $state(false);
	let passkeyMessage = $state<string | null>(null);

	/**
	 * `autoFill` is the ceremony behind the browser's autofill drop-down: it sits
	 * pending until a credential is picked, so it is started once on mount and
	 * never awaited for a result. Starting the explicit one aborts it.
	 */
	async function signInWithPasskey(autoFill = false) {
		if (!autoFill) {
			passkeyBusy = true;
			passkeyMessage = null;
		}

		try {
			const result = await signIn.passkey({ autoFill });
			if (result?.error) {
				// A dismissed autofill prompt is the normal way out of it.
				if (!autoFill) {
					passkeyMessage = passkeyErrorMessage(result.error, 'That passkey did not work.');
				}
				return;
			}
			await goto('/', { invalidateAll: true });
		} finally {
			if (!autoFill) passkeyBusy = false;
		}
	}

	onMount(() => {
		passkeys = passkeysSupported();
		if (!passkeys) return;
		// Not awaited: the promise settles when the person picks a passkey from
		// the email field, or never.
		void conditionalUiAvailable().then((available) => {
			if (available) void signInWithPasskey(true);
		});
	});
</script>

<svelte:head><title>Sign in · Links</title></svelte:head>

<div class="text-center">
	<h1 class="text-xl font-semibold tracking-tight">Sign in to Links</h1>
	<p class="text-muted-foreground mt-1.5 text-sm">Manage and measure your short links.</p>
</div>

{#if data.providers.length > 0 || passkeys}
	<div class="mt-8 flex flex-col gap-2">
		{#if data.providers.length > 0}
			<SocialButtons providers={data.providers} onselect={(id) => signIn.social({ provider: id })} />
		{/if}
		{#if passkeys}
			<Button
				variant="outline"
				class="w-full"
				disabled={passkeyBusy}
				onclick={() => signInWithPasskey()}
			>
				<Fingerprint class="size-4" />
				{passkeyBusy ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
			</Button>
		{/if}
	</div>

	{#if passkeyMessage}
		<p class="text-destructive mt-3 text-sm">{passkeyMessage}</p>
	{/if}

	<div class="my-6 flex items-center gap-3">
		<span class="bg-border h-px flex-1"></span>
		<span class="text-muted-foreground text-xs">or</span>
		<span class="bg-border h-px flex-1"></span>
	</div>
{:else}
	<div class="mt-8"></div>
{/if}

<form
	method="POST"
	class="flex flex-col gap-4"
	use:enhance={() => {
		submitting = true;
		return async ({ update }) => {
			await update();
			submitting = false;
		};
	}}
>
	<div class="flex flex-col gap-2">
		<Label for="email">Email</Label>
		<Input
			id="email"
			name="email"
			type="email"
			autocomplete="email webauthn"
			placeholder="you@example.com"
			value={form?.email ?? ''}
			required
		/>
	</div>

	<div class="flex flex-col gap-2">
		<Label for="password">Password</Label>
		<Input
			id="password"
			name="password"
			type="password"
			autocomplete="current-password"
			placeholder="••••••••••"
			required
		/>
	</div>

	{#if form?.message}
		<p class="text-destructive text-sm">{form.message}</p>
	{/if}

	<Button type="submit" class="w-full" disabled={submitting}>
		{submitting ? 'Signing in…' : 'Sign in'}
	</Button>
</form>

{#if data.signupMode !== 'closed'}
	<p class="text-muted-foreground mt-6 text-center text-sm">
		No account?
		<a href="/signup" class="text-foreground underline-offset-4 hover:underline">Create one</a>
	</p>
{/if}
