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

<svelte:head><title>Create account · Links</title></svelte:head>

<div class="text-center">
	<h1 class="text-xl font-semibold tracking-tight">Create your account</h1>
	<p class="text-muted-foreground mt-1.5 text-sm">
		{data.signupMode === 'invite'
			? 'This instance is invite-only.'
			: 'Start shortening links in a minute.'}
	</p>
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
		<Label for="name">Name</Label>
		<Input id="name" name="name" autocomplete="name" value={form?.name ?? ''} required />
	</div>

	<div class="flex flex-col gap-2">
		<Label for="email">Email</Label>
		<Input
			id="email"
			name="email"
			type="email"
			autocomplete="email"
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
			autocomplete="new-password"
			minlength={10}
			required
		/>
		<p class="text-muted-foreground text-xs">At least 10 characters.</p>
	</div>

	{#if form?.message}
		<p class="text-destructive text-sm">{form.message}</p>
	{/if}

	<Button type="submit" class="w-full" disabled={submitting}>
		{submitting ? 'Creating account…' : 'Create account'}
	</Button>
</form>

<p class="text-muted-foreground mt-6 text-center text-sm">
	Already have an account?
	<a href="/login" class="text-foreground underline-offset-4 hover:underline">Sign in</a>
</p>
