<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { signIn } from '$lib/auth-client';
	import SocialButtons from '$lib/components/app/social-buttons.svelte';

	let { data, form } = $props();
	let submitting = $state(false);
</script>

<svelte:head><title>Sign in · Links</title></svelte:head>

<div class="text-center">
	<h1 class="text-xl font-semibold tracking-tight">Sign in to Links</h1>
	<p class="text-muted-foreground mt-1.5 text-sm">Manage and measure your short links.</p>
</div>

{#if data.providers.length > 0}
	<div class="mt-8">
		<SocialButtons providers={data.providers} onselect={(id) => signIn.social({ provider: id })} />
	</div>
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
			autocomplete="email"
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
