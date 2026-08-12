<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		Check,
		Folder,
		Globe,
		KeyRound,
		Plus,
		RefreshCw,
		Send,
		Star,
		Trash2,
		Webhook
	} from '@lucide/svelte';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Switch } from '$lib/components/ui/switch';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import CopyButton from '$lib/components/app/copy-button.svelte';
	import { formatDateTime, timeAgo } from '$lib/format';
	import { toast } from 'svelte-sonner';
	import { WEBHOOK_EVENTS, type SerializedDomain } from '$lib/types';

	let { data, form } = $props();

	let createOpen = $state(false);
	let newKey = $state<string | null>(null);
	let revoking = $state<string | null>(null);

	let domainOpen = $state(false);
	let editingDomain = $state<SerializedDomain | null>(null);
	let deletingDomain = $state<SerializedDomain | null>(null);

	let folderName = $state('');
	let webhookOpen = $state(false);
	let newSecret = $state<string | null>(null);

	const rows = $derived([
		{ label: 'Short link base', value: `${data.instance.shortBase}/…` },
		{ label: 'Dashboard', value: data.instance.appBase },
		{ label: 'Sign-ups', value: data.instance.signupMode },
		{
			label: 'Analytics Engine',
			value: data.instance.analyticsEngine ? 'Enabled' : 'Not configured'
		}
	]);

	function openDomain(domain: SerializedDomain | null) {
		editingDomain = domain;
		domainOpen = true;
	}

	function deliveriesFor(webhookId: string) {
		return data.deliveries.filter((delivery) => delivery.webhookId === webhookId).slice(0, 3);
	}
</script>

<svelte:head><title>Settings · Links</title></svelte:head>

<div class="flex max-w-3xl flex-col gap-8">
	<div>
		<h1 class="text-lg font-semibold tracking-tight">Settings</h1>
		<p class="text-muted-foreground mt-1 text-sm">
			Domains, folders, webhooks, API access, and instance details.
		</p>
	</div>

	<!-- Account -------------------------------------------------------------- -->
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

	<!-- Domains -------------------------------------------------------------- -->
	<section class="border-border bg-card rounded-xl border">
		<div class="border-border flex items-center justify-between border-b px-5 py-4">
			<div>
				<h2 class="text-sm font-medium">Domains</h2>
				<p class="text-muted-foreground mt-0.5 text-xs">
					Each domain has its own slug namespace. The default one also answers under
					<code class="font-mono">SHORT_PREFIX</code> on any host.
				</p>
			</div>
			<Button size="sm" onclick={() => openDomain(null)}>
				<Plus class="size-4" />
				Add domain
			</Button>
		</div>

		<ul class="divide-border divide-y">
			{#each data.domains as domain (domain.id)}
				<li class="flex items-center gap-4 px-5 py-3">
					<Globe class="text-muted-foreground size-4 shrink-0" />
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<p class="truncate font-mono text-sm">{domain.hostname}{domain.prefix}</p>
							{#if domain.isDefault}
								<Badge variant="outline" class="h-5 gap-1 text-[11px] font-normal">
									<Star class="size-3" />
									default
								</Badge>
							{/if}
						</div>
						<p class="text-muted-foreground text-xs">
							{domain.linkCount}
							{domain.linkCount === 1 ? 'link' : 'links'} · {domain.slugLength}-character slugs ·
							{domain.redirectStatus}
						</p>
					</div>
					<Button variant="outline" size="sm" onclick={() => openDomain(domain)}>Edit</Button>
					{#if data.domains.length > 1}
						<Button
							variant="ghost"
							size="icon"
							class="text-muted-foreground hover:text-destructive size-8"
							aria-label="Remove domain"
							onclick={() => (deletingDomain = domain)}
						>
							<Trash2 class="size-4" />
						</Button>
					{/if}
				</li>
			{/each}
		</ul>
	</section>

	<!-- Folders -------------------------------------------------------------- -->
	<section class="border-border bg-card rounded-xl border">
		<div class="border-border border-b px-5 py-4">
			<h2 class="text-sm font-medium">Folders</h2>
			<p class="text-muted-foreground mt-0.5 text-xs">
				Deleting a folder leaves its links behind at the top level.
			</p>
		</div>

		{#if data.folders.length > 0}
			<ul class="divide-border divide-y">
				{#each data.folders as folder (folder.id)}
					<li class="flex items-center gap-4 px-5 py-3">
						<Folder class="text-muted-foreground size-4 shrink-0" />
						<form
							method="POST"
							action="?/updateFolder"
							class="flex min-w-0 flex-1 items-center gap-2"
							use:enhance={() => async ({ update }) => {
								toast.success('Folder renamed');
								await update({ reset: false });
							}}
						>
							<input type="hidden" name="id" value={folder.id} />
							<Input name="name" value={folder.name} class="h-8 max-w-[240px] text-sm" />
							<Button type="submit" variant="ghost" size="sm">Save</Button>
						</form>
						<span class="text-muted-foreground text-xs tabular-nums">{folder.linkCount}</span>
						<form
							method="POST"
							action="?/deleteFolder"
							use:enhance={() => async ({ update }) => {
								toast.success('Folder deleted');
								await update();
							}}
						>
							<input type="hidden" name="id" value={folder.id} />
							<Button
								type="submit"
								variant="ghost"
								size="icon"
								class="text-muted-foreground hover:text-destructive size-8"
								aria-label="Delete folder"
							>
								<Trash2 class="size-4" />
							</Button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}

		<form
			method="POST"
			action="?/createFolder"
			class="border-border flex items-center gap-2 border-t px-5 py-4"
			use:enhance={() => async ({ update }) => {
				folderName = '';
				await update({ reset: true });
			}}
		>
			<Input name="name" bind:value={folderName} placeholder="New folder name" class="max-w-xs" />
			<Button type="submit" variant="outline" size="sm" disabled={!folderName.trim()}>
				<Plus class="size-4" />
				Add
			</Button>
		</form>
	</section>

	<!-- Webhooks ------------------------------------------------------------- -->
	<section class="border-border bg-card rounded-xl border">
		<div class="border-border flex items-center justify-between border-b px-5 py-4">
			<div>
				<h2 class="text-sm font-medium">Webhooks</h2>
				<p class="text-muted-foreground mt-0.5 text-xs">
					Signed with HMAC-SHA256 in <code class="font-mono">X-Links-Signature</code>, delivered
					after the redirect has already gone out.
				</p>
			</div>
			<Button size="sm" onclick={() => (webhookOpen = true)}>
				<Plus class="size-4" />
				Add webhook
			</Button>
		</div>

		{#if data.webhooks.length === 0}
			<div class="flex flex-col items-center gap-2 px-5 py-10 text-center">
				<Webhook class="text-muted-foreground size-5" />
				<p class="text-muted-foreground text-sm">No webhooks yet.</p>
			</div>
		{:else}
			<ul class="divide-border divide-y">
				{#each data.webhooks as hook (hook.id)}
					<li class="flex flex-col gap-2 px-5 py-3">
						<div class="flex items-center gap-4">
							<div class="min-w-0 flex-1">
								<p class="truncate font-mono text-xs">{hook.url}</p>
								<p class="text-muted-foreground mt-0.5 text-xs">
									{hook.events.length}
									{hook.events.length === 1 ? 'event' : 'events'}
									{#if hook.lastFiredAt}
										· last fired {timeAgo(hook.lastFiredAt)}
										{#if hook.lastStatus}
											<span class={hook.lastStatus < 400 ? 'text-emerald-500' : 'text-destructive'}>
												({hook.lastStatus})
											</span>
										{/if}
									{/if}
									{#if hook.failureCount > 0}
										· <span class="text-destructive">{hook.failureCount} failures</span>
									{/if}
								</p>
							</div>

							<form
								method="POST"
								action="?/testWebhook"
								use:enhance={() => async ({ result, update }) => {
									const status = (result as { data?: { webhookTest?: { status: number } } }).data
										?.webhookTest?.status;
									toast.success(status ? `Endpoint answered ${status}` : 'Test delivered');
									await update();
								}}
							>
								<input type="hidden" name="id" value={hook.id} />
								<Button type="submit" variant="outline" size="sm">
									<Send class="size-4" />
									Test
								</Button>
							</form>

							<form
								method="POST"
								action="?/updateWebhook"
								use:enhance={() => async ({ update }) => await update()}
							>
								<input type="hidden" name="id" value={hook.id} />
								<input type="hidden" name="url" value={hook.url} />
								<input type="hidden" name="enabled" value={String(!hook.enabled)} />
								{#each hook.events as event (event)}
									<input type="hidden" name="events" value={event} />
								{/each}
								<Switch checked={hook.enabled} onclick={(event) =>
									(event.currentTarget as HTMLElement).closest('form')?.requestSubmit()} />
							</form>

							<form
								method="POST"
								action="?/deleteWebhook"
								use:enhance={() => async ({ update }) => {
									toast.success('Webhook removed');
									await update();
								}}
							>
								<input type="hidden" name="id" value={hook.id} />
								<Button
									type="submit"
									variant="ghost"
									size="icon"
									class="text-muted-foreground hover:text-destructive size-8"
									aria-label="Delete webhook"
								>
									<Trash2 class="size-4" />
								</Button>
							</form>
						</div>

						<div class="flex flex-wrap gap-1">
							{#each hook.events as event (event)}
								<Badge variant="outline" class="h-5 font-mono text-[10px] font-normal">
									{event}
								</Badge>
							{/each}
						</div>

						{#each deliveriesFor(hook.id) as delivery (delivery.id)}
							<p class="text-muted-foreground/70 font-mono text-[11px]">
								{timeAgo(delivery.timestamp)} · {delivery.event} ·
								{delivery.error ? delivery.error : `${delivery.status} in ${delivery.durationMs}ms`}
							</p>
						{/each}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- API keys ------------------------------------------------------------- -->
	<section class="border-border bg-card rounded-xl border">
		<div class="border-border flex items-center justify-between border-b px-5 py-4">
			<div>
				<h2 class="text-sm font-medium">API keys</h2>
				<p class="text-muted-foreground mt-0.5 text-xs">
					Bearer tokens for <code class="font-mono">/api/v1</code>.
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
							<p>{key.lastUsedAt ? `used ${timeAgo(key.lastUsedAt)}` : 'never used'}</p>
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

	<!-- Instance ------------------------------------------------------------- -->
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

<!-- Domain editor ----------------------------------------------------------- -->
<Dialog.Root bind:open={domainOpen}>
	<Dialog.Content class="sm:max-w-[520px]">
		<Dialog.Header>
			<Dialog.Title>{editingDomain ? 'Edit domain' : 'Add domain'}</Dialog.Title>
			<Dialog.Description>
				Point the hostname at your redirect Worker in Cloudflare, then register it here so its slugs
				resolve.
			</Dialog.Description>
		</Dialog.Header>

		<form
			method="POST"
			action={editingDomain ? '?/updateDomain' : '?/createDomain'}
			class="flex flex-col gap-4"
			use:enhance={() => async ({ result, update }) => {
				if (result.type !== 'failure') {
					toast.success(editingDomain ? 'Domain updated' : 'Domain added');
					domainOpen = false;
				}
				await update({ reset: false });
			}}
		>
			{#if editingDomain}
				<input type="hidden" name="id" value={editingDomain.id} />
			{/if}

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="domain-hostname">Hostname</Label>
					<Input
						id="domain-hostname"
						name="hostname"
						value={editingDomain?.hostname ?? ''}
						placeholder="link.example.com"
						class="font-mono"
						required
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="domain-prefix">Path prefix</Label>
					<Input
						id="domain-prefix"
						name="prefix"
						value={editingDomain?.prefix ?? ''}
						placeholder="/l — leave empty for root"
						class="font-mono"
					/>
				</div>
			</div>

			<div class="grid gap-4 sm:grid-cols-3">
				<div class="flex flex-col gap-2">
					<Label for="domain-label">Label</Label>
					<Input id="domain-label" name="label" value={editingDomain?.label ?? ''} />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="domain-slug-length">Slug length</Label>
					<Input
						id="domain-slug-length"
						name="slugLength"
						type="number"
						min="3"
						max="24"
						value={editingDomain?.slugLength ?? 6}
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="domain-status">Default status</Label>
					<Input
						id="domain-status"
						name="redirectStatus"
						type="number"
						value={editingDomain?.redirectStatus ?? 302}
					/>
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<Label for="domain-main">Root redirect</Label>
				<Input
					id="domain-main"
					name="mainRedirect"
					value={editingDomain?.mainRedirect ?? ''}
					placeholder="Where https://{editingDomain?.hostname ?? 'link.example.com'}/ goes"
				/>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="domain-404">Unknown slug goes to</Label>
					<Input
						id="domain-404"
						name="notFoundRedirect"
						value={editingDomain?.notFoundRedirect ?? ''}
						placeholder="Default 404 page"
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="domain-expired">Expired links go to</Label>
					<Input
						id="domain-expired"
						name="expiredRedirect"
						value={editingDomain?.expiredRedirect ?? ''}
						placeholder="Default 410 page"
					/>
				</div>
			</div>

			<label class="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					name="isDefault"
					value="true"
					checked={editingDomain?.isDefault ?? data.domains.length === 0}
					class="accent-foreground"
				/>
				Make this the default domain
			</label>

			{#if form?.message}
				<p class="text-destructive text-sm">{form.message}</p>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="ghost" onclick={() => (domainOpen = false)}>Cancel</Button>
				<Button type="submit">{editingDomain ? 'Save changes' : 'Add domain'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root
	open={deletingDomain !== null}
	onOpenChange={(open) => !open && (deletingDomain = null)}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Remove {deletingDomain?.hostname}?</AlertDialog.Title>
			<AlertDialog.Description>
				Its {deletingDomain?.linkCount} links and all of their click history are deleted with it — a
				slug only means anything inside its own domain. This cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<form
				method="POST"
				action="?/deleteDomain"
				use:enhance={() => async ({ update }) => {
					toast.success('Domain removed');
					deletingDomain = null;
					await update();
				}}
			>
				<input type="hidden" name="id" value={deletingDomain?.id} />
				<button type="submit" class={buttonVariants({ variant: 'destructive' })}>
					Remove domain
				</button>
			</form>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<!-- Webhook creator --------------------------------------------------------- -->
<Dialog.Root bind:open={webhookOpen}>
	<Dialog.Content class="sm:max-w-[480px]">
		<Dialog.Header>
			<Dialog.Title>Add webhook</Dialog.Title>
			<Dialog.Description>
				The signing secret is shown once, right after it is created.
			</Dialog.Description>
		</Dialog.Header>

		{#if newSecret}
			<div class="flex flex-col gap-3">
				<div class="border-border bg-muted/40 flex items-center gap-2 rounded-lg border p-3">
					<code class="flex-1 font-mono text-xs break-all">{newSecret}</code>
					<CopyButton value={newSecret} label="Copy secret" variant="outline" />
				</div>
				<Button
					onclick={() => {
						newSecret = null;
						webhookOpen = false;
					}}
				>
					<Check class="size-4" />
					I've saved it
				</Button>
			</div>
		{:else}
			<form
				method="POST"
				action="?/createWebhook"
				class="flex flex-col gap-4"
				use:enhance={() => async ({ result, update }) => {
					const secret = (result as { data?: { webhookSecret?: string } }).data?.webhookSecret;
					if (secret) newSecret = secret;
					await update({ reset: true });
				}}
			>
				<div class="flex flex-col gap-2">
					<Label for="webhook-url">Endpoint URL</Label>
					<Input
						id="webhook-url"
						name="url"
						placeholder="https://example.com/hooks/links"
						required
					/>
				</div>

				<div class="flex flex-col gap-2">
					<Label>Events</Label>
					<div class="grid grid-cols-2 gap-1.5">
						{#each WEBHOOK_EVENTS as event (event)}
							<label class="flex items-center gap-2 font-mono text-xs">
								<input
									type="checkbox"
									name="events"
									value={event}
									checked={event === 'link.clicked'}
									class="accent-foreground"
								/>
								{event}
							</label>
						{/each}
					</div>
				</div>

				{#if form?.message}
					<p class="text-destructive text-sm">{form.message}</p>
				{/if}

				<Dialog.Footer>
					<Button type="button" variant="ghost" onclick={() => (webhookOpen = false)}>Cancel</Button
					>
					<Button type="submit">Add webhook</Button>
				</Dialog.Footer>
			</form>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- API key creator --------------------------------------------------------- -->
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
