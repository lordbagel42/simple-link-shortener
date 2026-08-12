<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		Archive,
		ArchiveRestore,
		BarChart3,
		Clock,
		ExternalLink,
		EyeOff,
		Lock,
		MoreHorizontal,
		Pencil,
		Power,
		QrCode,
		Smartphone,
		SplitSquareHorizontal,
		Target,
		Trash2
	} from '@lucide/svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { toast } from 'svelte-sonner';
	import { formatCount, prettyUrl, timeAgo } from '$lib/format';
	import CopyButton from './copy-button.svelte';
	import type { SerializedFolder, SerializedLink } from '$lib/types';

	let {
		link,
		folder = null,
		selected = false,
		onselect,
		onedit,
		onqr
	}: {
		link: SerializedLink;
		folder?: SerializedFolder | null;
		selected?: boolean;
		onselect: (id: string, checked: boolean) => void;
		onedit: (link: SerializedLink) => void;
		onqr: (link: SerializedLink) => void;
	} = $props();

	const expired = $derived(link.expiresAt !== null && link.expiresAt <= Date.now());
	const display = $derived(link.shortUrl.replace(/^https?:\/\//, ''));

	let confirmingDelete = $state(false);
</script>

<div
	class="border-border hover:bg-muted/40 group flex items-center gap-3 border-b px-4 py-3 transition-colors last:border-b-0
		{selected ? 'bg-muted/60' : ''}"
>
	<Checkbox
		checked={selected}
		onCheckedChange={(checked) => onselect(link.id, checked === true)}
		aria-label="Select /{link.slug}"
		class="shrink-0"
	/>

	<div class="min-w-0 flex-1">
		<div class="flex items-center gap-1.5">
			<a
				href={link.shortUrl}
				target="_blank"
				rel="noreferrer noopener"
				class="truncate font-mono text-sm font-medium hover:underline"
			>
				{display}
			</a>
			<CopyButton
				value={link.shortUrl}
				label="Copy short link"
				class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
			/>

			{#if link.archived}
				<Badge variant="secondary" class="h-5 text-[11px]">Archived</Badge>
			{:else if !link.enabled}
				<Badge variant="secondary" class="h-5 text-[11px]">Disabled</Badge>
			{:else if expired}
				<Badge variant="secondary" class="h-5 text-[11px]">Expired</Badge>
			{/if}

			{#if link.hasPassword}
				<Lock class="text-muted-foreground size-3.5" aria-label="Password protected" />
			{/if}
			{#if link.expiresAt && !expired}
				<Clock class="text-muted-foreground size-3.5" aria-label="Expires" />
			{/if}
			{#if link.rules.length > 0}
				<Target class="text-muted-foreground size-3.5" aria-label="Has targeting rules" />
			{/if}
			{#if link.variants.length > 0}
				<SplitSquareHorizontal class="text-muted-foreground size-3.5" aria-label="Split test" />
			{/if}
			{#if link.deepLink}
				<Smartphone class="text-muted-foreground size-3.5" aria-label="Deep links" />
			{/if}
			{#if link.cloak?.enabled || link.hideReferrer}
				<EyeOff class="text-muted-foreground size-3.5" aria-label="Cloaked or referrer hidden" />
			{/if}
		</div>

		<div class="mt-0.5 flex items-center gap-2">
			<span class="text-muted-foreground truncate text-xs">
				{link.title ? `${link.title} · ` : ''}{prettyUrl(link.destination, 64)}
			</span>
		</div>

		{#if link.tags.length > 0 || folder}
			<div class="mt-1.5 flex flex-wrap gap-1">
				{#if folder}
					<a href="/?folder={encodeURIComponent(folder.id)}">
						<Badge variant="secondary" class="h-5 text-[11px] font-normal">{folder.name}</Badge>
					</a>
				{/if}
				{#each link.tags as tag (tag)}
					<a href="/?tag={encodeURIComponent(tag)}">
						<Badge variant="outline" class="h-5 text-[11px] font-normal">{tag}</Badge>
					</a>
				{/each}
			</div>
		{/if}
	</div>

	<a
		href="/links/{link.id}"
		class="hover:bg-muted hidden shrink-0 rounded-lg px-3 py-1.5 text-right sm:block"
		title="{link.clickCount} clicks, {link.uniqueCount} unique visitors"
	>
		<p class="text-sm font-medium tabular-nums">{formatCount(link.clickCount)}</p>
		<p class="text-muted-foreground text-[11px]">
			{#if link.conversionCount > 0}
				{formatCount(link.conversionCount)} conv.
			{:else}
				{formatCount(link.uniqueCount)} unique
			{/if}
		</p>
	</a>

	<div class="text-muted-foreground hidden w-28 shrink-0 text-right text-xs md:block">
		{link.lastClickedAt ? timeAgo(link.lastClickedAt) : `added ${timeAgo(link.createdAt)}`}
	</div>

	<div class="flex shrink-0 items-center gap-1">
		<Button
			variant="ghost"
			size="icon"
			class="text-muted-foreground hover:text-foreground size-7"
			href={link.destination}
			target="_blank"
			rel="noreferrer noopener"
			aria-label="Open destination"
		>
			<ExternalLink class="size-3.5" />
		</Button>

		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button
						{...props}
						variant="ghost"
						size="icon"
						class="text-muted-foreground hover:text-foreground size-7"
						aria-label="Link actions"
					>
						<MoreHorizontal class="size-4" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="w-48">
				<DropdownMenu.Item onSelect={() => onedit(link)}>
					<Pencil class="size-4" />
					Edit
				</DropdownMenu.Item>
				<DropdownMenu.Item onSelect={() => onqr(link)}>
					<QrCode class="size-4" />
					QR code
				</DropdownMenu.Item>
				<DropdownMenu.Item onSelect={() => window.location.assign(`/links/${link.id}`)}>
					<BarChart3 class="size-4" />
					Analytics
				</DropdownMenu.Item>
				<DropdownMenu.Separator />

				<form
					method="POST"
					action="?/toggle"
					use:enhance={() => async ({ update }) => {
						toast.success(link.enabled ? 'Link disabled' : 'Link enabled');
						await update();
					}}
				>
					<input type="hidden" name="id" value={link.id} />
					<input type="hidden" name="enabled" value={String(!link.enabled)} />
					<DropdownMenu.Item
						closeOnSelect={false}
						onSelect={(event) =>
							(event.currentTarget as HTMLElement).closest('form')?.requestSubmit()}
					>
						<Power class="size-4" />
						{link.enabled ? 'Disable' : 'Enable'}
					</DropdownMenu.Item>
				</form>

				<form
					method="POST"
					action="?/bulkArchive"
					use:enhance={() => async ({ update }) => {
						toast.success(link.archived ? 'Link restored' : 'Link archived');
						await update();
					}}
				>
					<input type="hidden" name="ids" value={link.id} />
					<input type="hidden" name="archived" value={String(!link.archived)} />
					<DropdownMenu.Item
						closeOnSelect={false}
						onSelect={(event) =>
							(event.currentTarget as HTMLElement).closest('form')?.requestSubmit()}
					>
						{#if link.archived}
							<ArchiveRestore class="size-4" />
							Restore
						{:else}
							<Archive class="size-4" />
							Archive
						{/if}
					</DropdownMenu.Item>
				</form>

				<DropdownMenu.Separator />
				<DropdownMenu.Item variant="destructive" onSelect={() => (confirmingDelete = true)}>
					<Trash2 class="size-4" />
					Delete
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</div>
</div>

<AlertDialog.Root bind:open={confirmingDelete}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete /{link.slug}?</AlertDialog.Title>
			<AlertDialog.Description>
				The short link stops working immediately and its
				{formatCount(link.clickCount)} recorded clicks are deleted. This cannot be undone —
				archive it instead if you only want it out of the way.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<form
				method="POST"
				action="?/delete"
				use:enhance={() => async ({ update }) => {
					toast.success(`Deleted /${link.slug}`);
					await update();
				}}
			>
				<input type="hidden" name="id" value={link.id} />
				<button type="submit" class={buttonVariants({ variant: 'destructive' })}>Delete link</button>
			</form>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
