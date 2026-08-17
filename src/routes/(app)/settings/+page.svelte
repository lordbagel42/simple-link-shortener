<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { Fingerprint, KeyRound, Plus, RefreshCw, Trash2, Check, Pencil } from '@lucide/svelte';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import CopyButton from '$lib/components/app/copy-button.svelte';
	import { formatDateTime, timeAgo } from '$lib/format';
	import { passkey } from '$lib/auth-client';
	import { passkeyErrorMessage, passkeysSupported } from '$lib/passkey';
	import { toast } from 'svelte-sonner';

	let { data, form } = $props();

	let createOpen = $state(false);
	let newKey = $state<string | null>(null);
	let revoking = $state<string | null>(null);

	let passkeysAvailable = $state(false);
	let addPasskeyOpen = $state(false);
	let addingPasskey = $state(false);
	let passkeyName = $state('');
	let passkeyMessage = $state<string | null>(null);
	let renaming = $state<{ id: string; name: string } | null>(null);
	let removingPasskey = $state<string | null>(null);

	onMount(() => {
		passkeysAvailable = passkeysSupported();
	});

	async function addPasskey() {
		addingPasskey = true;
		passkeyMessage = null;

		try {
			const result = await passkey.addPasskey({ name: passkeyName.trim() || undefined });
			if (result?.error) {
				passkeyMessage = passkeyErrorMessage(result.error, 'Could not register that passkey.');
				return;
			}
			addPasskeyOpen = false;
			passkeyName = '';
			toast.success('Passkey added');
			await invalidateAll();
		} finally {
			addingPasskey = false;
		}
	}

	const rows = $derived([
		{ label: 'Short link base', value: `${data.instance.shortBase}/…` },
		{ label: 'Dashboard', value: data.instance.appBase },
		{ label: 'Sign-ups', value: data.instance.signupMode },
		{
			label: 'Analytics Engine',
			value: data.instance.analyticsEngine ? 'Enabled' : 'Not configured'
		}
	]);
</script>

<svelte:head><title>Settings · Links</title></svelte:head>

<div class="flex max-w-3xl flex-col gap-8">
	<div>
		<h1 class="text-lg font-semibold tracking-tight">Settings</h1>
		<p class="text-muted-foreground mt-1 text-sm">Account, API access, and instance details.</p>
	</div>

	<section class="border-border bg-card rounded-xl border">
		<div class="border-border border-b px-5 py-4">
			<h2 class="text-sm font-medium">Account</h2>
		</div>
		<dl class="divide-border divide-y">
			<div class="flex items-center justify-between px-5 py-3 text-sm">
				<dt class="text-muted-foreground">Name</dt>
				<dd>{data.user?.name}</dd>
			</div>
			<div class="flex items-center justify-between px-5 py-3 text-sm">
				<dt class="text-muted-foreground">Email</dt>
				<dd>{data.user?.email}</dd>
			</div>
		</dl>
	</section>

	<section class="border-border bg-card rounded-xl border">
		<div class="border-border flex items-center justify-between gap-4 border-b px-5 py-4">
			<div>
				<h2 class="text-sm font-medium">Passkeys</h2>
				<p class="text-muted-foreground mt-0.5 text-xs">
					Sign in with Touch ID, Windows Hello or a security key instead of a password.
				</p>
			</div>
			{#if passkeysAvailable}
				<Button
					size="sm"
					onclick={() => {
						passkeyMessage = null;
						addPasskeyOpen = true;
					}}
				>
					<Plus class="size-4" />
					Add passkey
				</Button>
			{/if}
		</div>

		{#if data.passkeys.length === 0}
			<div class="flex flex-col items-center gap-2 px-5 py-10 text-center">
				<Fingerprint class="text-muted-foreground size-5" />
				<p class="text-muted-foreground text-sm">
					{passkeysAvailable ? 'No passkeys yet.' : 'This browser does not support passkeys.'}
				</p>
			</div>
		{:else}
			<ul class="divide-border divide-y">
				{#each data.passkeys as key (key.id)}
					<li class="flex items-center gap-3 px-5 py-3">
						<Fingerprint class="text-muted-foreground size-4 shrink-0" />
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium">{key.name}</p>
							<p class="text-muted-foreground text-xs" title={formatDateTime(key.createdAt)}>
								added {timeAgo(key.createdAt)}
							</p>
						</div>
						{#if key.backedUp}
							<Badge variant="secondary" class="hidden sm:inline-flex">Synced</Badge>
						{/if}
						<!-- Opens empty when the label on show was derived from the authenticator
						     rather than typed, so a guess never gets stored as a real name. -->
						<Button
							variant="ghost"
							size="icon"
							class="text-muted-foreground size-8"
							aria-label="Rename passkey"
							onclick={() => (renaming = { id: key.id, name: key.named ? key.name : '' })}
						>
							<Pencil class="size-4" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							class="text-muted-foreground hover:text-destructive size-8"
							aria-label="Remove passkey"
							onclick={() => (removingPasskey = key.id)}
						>
							<Trash2 class="size-4" />
						</Button>
					</li>
				{/each}
			</ul>
		{/if}

		{#if form?.passkeyMessage}
			<p class="text-destructive border-border border-t px-5 py-3 text-sm">
				{form.passkeyMessage}
			</p>
		{/if}
	</section>

	<section class="border-border bg-card rounded-xl border">
		<div class="border-border flex items-center justify-between border-b px-5 py-4">
			<div>
				<h2 class="text-sm font-medium">API keys</h2>
				<p class="text-muted-foreground mt-0.5 text-xs">
					Bearer tokens for <code class="font-mono">/api/v1/links</code>.
				</p>
			</div>
			<Button size="sm" onclick={() => (createOpen = true)}>
				<Plus class="size-4" />
				New key
			</Button>
		</div>

		{#if data.keys.length === 0}
			<div class="flex flex-col items-center gap-2 px-5 py-10 text-center">
				<KeyRound class="text-muted-foreground size-5" />
				<p class="text-muted-foreground text-sm">No API keys yet.</p>
			</div>
		{:else}
			<ul class="divide-border divide-y">
				{#each data.keys as key (key.id)}
					<li class="flex items-center gap-4 px-5 py-3">
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium">{key.name}</p>
							<p class="text-muted-foreground font-mono text-xs">{key.prefix}…</p>
						</div>
						<div class="text-muted-foreground hidden text-right text-xs sm:block">
							<p title={formatDateTime(key.createdAt)}>created {timeAgo(key.createdAt)}</p>
							<p>
								{key.lastUsedAt ? `used ${timeAgo(key.lastUsedAt)}` : 'never used'}
							</p>
						</div>
						<Button
							variant="ghost"
							size="icon"
							class="text-muted-foreground hover:text-destructive size-8"
							aria-label="Revoke key"
							onclick={() => (revoking = key.id)}
						>
							<Trash2 class="size-4" />
						</Button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section class="border-border bg-card rounded-xl border">
		<div class="border-border border-b px-5 py-4">
			<h2 class="text-sm font-medium">Instance</h2>
		</div>
		<dl class="divide-border divide-y">
			{#each rows as row (row.label)}
				<div class="flex items-center justify-between gap-4 px-5 py-3 text-sm">
					<dt class="text-muted-foreground shrink-0">{row.label}</dt>
					<dd class="truncate font-mono text-xs">{row.value}</dd>
				</div>
			{/each}
		</dl>
		<div class="border-border flex items-center justify-between border-t px-5 py-4">
			<div>
				<p class="text-sm font-medium">Resync edge cache</p>
				<p class="text-muted-foreground mt-0.5 text-xs">
					Republish every link from D1 into KV. Safe to run any time.
				</p>
			</div>
			<form
				method="POST"
				action="?/resync"
				use:enhance={() => async ({ result, update }) => {
					if (result.type === 'success') {
						toast.success(`Republished ${result.data?.resynced} links`);
					}
					await update();
				}}
			>
				<Button type="submit" variant="outline" size="sm">
					<RefreshCw class="size-4" />
					Resync
				</Button>
			</form>
		</div>
	</section>
</div>

<Dialog.Root bind:open={addPasskeyOpen}>
	<Dialog.Content class="sm:max-w-[440px]">
		<Dialog.Header>
			<Dialog.Title>Add a passkey</Dialog.Title>
			<Dialog.Description>
				Your device will ask you to confirm. The key itself never leaves it — only its public
				half is stored here.
			</Dialog.Description>
		</Dialog.Header>

		<form
			class="flex flex-col gap-4"
			onsubmit={(event) => {
				event.preventDefault();
				addPasskey();
			}}
		>
			<div class="flex flex-col gap-2">
				<Label for="passkey-name">Name</Label>
				<Input id="passkey-name" bind:value={passkeyName} placeholder="Work laptop" />
				<p class="text-muted-foreground text-xs">
					Optional. Left blank, it's named after the authenticator where that's recognisable.
				</p>
			</div>

			{#if passkeyMessage}
				<p class="text-destructive text-sm">{passkeyMessage}</p>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="ghost" onclick={() => (addPasskeyOpen = false)}>
					Cancel
				</Button>
				<Button type="submit" disabled={addingPasskey}>
					{addingPasskey ? 'Waiting for your device…' : 'Add passkey'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={renaming !== null} onOpenChange={(open) => !open && (renaming = null)}>
	<Dialog.Content class="sm:max-w-[440px]">
		<Dialog.Header>
			<Dialog.Title>Rename passkey</Dialog.Title>
			<Dialog.Description>Only the label changes — the credential is untouched.</Dialog.Description>
		</Dialog.Header>

		<form
			method="POST"
			action="?/renamePasskey"
			class="flex flex-col gap-4"
			use:enhance={() => async ({ result, update }) => {
				if (result.type === 'success') toast.success('Passkey renamed');
				// Closed either way: a failure shows its message on the section below.
				renaming = null;
				await update();
			}}
		>
			<input type="hidden" name="id" value={renaming?.id} />
			<div class="flex flex-col gap-2">
				<Label for="passkey-rename">Name</Label>
				<Input id="passkey-rename" name="name" value={renaming?.name ?? ''} required />
			</div>
			<Dialog.Footer>
				<Button type="button" variant="ghost" onclick={() => (renaming = null)}>Cancel</Button>
				<Button type="submit">Save</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root
	open={removingPasskey !== null}
	onOpenChange={(open) => !open && (removingPasskey = null)}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Remove this passkey?</AlertDialog.Title>
			<AlertDialog.Description>
				It stops working for signing in. Your device keeps its own copy until you delete it there
				too.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<form
				method="POST"
				action="?/deletePasskey"
				use:enhance={() => async ({ result, update }) => {
					if (result.type === 'success') toast.success('Passkey removed');
					removingPasskey = null;
					await update();
				}}
			>
				<input type="hidden" name="id" value={removingPasskey} />
				<button type="submit" class={buttonVariants({ variant: 'destructive' })}>Remove</button>
			</form>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<Dialog.Root bind:open={createOpen}>
	<Dialog.Content class="sm:max-w-[440px]">
		<Dialog.Header>
			<Dialog.Title>Create API key</Dialog.Title>
			<Dialog.Description>
				The token is shown once. Store it somewhere safe before closing this dialog.
			</Dialog.Description>
		</Dialog.Header>

		{#if newKey}
			<div class="flex flex-col gap-3">
				<div class="border-border bg-muted/40 flex items-center gap-2 rounded-lg border p-3">
					<code class="flex-1 font-mono text-xs break-all">{newKey}</code>
					<CopyButton value={newKey} label="Copy token" variant="outline" />
				</div>
				<Button
					onclick={() => {
						newKey = null;
						createOpen = false;
					}}
				>
					<Check class="size-4" />
					I've saved it
				</Button>
			</div>
		{:else}
			<form
				method="POST"
				action="?/createKey"
				class="flex flex-col gap-4"
				use:enhance={() => async ({ result, update }) => {
					if (result.type === 'success' && result.data?.token) {
						newKey = result.data.token as string;
					}
					await update({ reset: true });
				}}
			>
				<div class="flex flex-col gap-2">
					<Label for="key-name">Name</Label>
					<Input id="key-name" name="name" placeholder="CI deploy script" required />
				</div>
				{#if form?.message}
					<p class="text-destructive text-sm">{form.message}</p>
				{/if}
				<Dialog.Footer>
					<Button type="button" variant="ghost" onclick={() => (createOpen = false)}>Cancel</Button>
					<Button type="submit">Create key</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root open={revoking !== null} onOpenChange={(open) => !open && (revoking = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Revoke this API key?</AlertDialog.Title>
			<AlertDialog.Description>
				Anything using it will start getting 401s immediately.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<form
				method="POST"
				action="?/revokeKey"
				use:enhance={() => async ({ update }) => {
					toast.success('API key revoked');
					revoking = null;
					await update();
				}}
			>
				<input type="hidden" name="id" value={revoking} />
				<button type="submit" class={buttonVariants({ variant: 'destructive' })}>Revoke</button>
			</form>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
