<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		Archive,
		ArchiveRestore,
		ArrowLeft,
		Clock,
		ExternalLink,
		EyeOff,
		Gauge,
		Lock,
		Pencil,
		QrCode,
		Smartphone,
		SplitSquareHorizontal,
		Target,
		Trash2
	} from '@lucide/svelte';
	import { Button, buttonVariants } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import CopyButton from '$lib/components/app/copy-button.svelte';
	import LinkDialog from '$lib/components/app/link-dialog.svelte';
	import QrDialog from '$lib/components/app/qr-dialog.svelte';
	import AnalyticsView from '$lib/components/app/analytics-view.svelte';
	import { formatDateTime, formatNumber, prettyUrl } from '$lib/format';

	let { data } = $props();

	let editOpen = $state(false);
	let qrOpen = $state(false);
	let confirmingDelete = $state(false);

	const link = $derived(data.link);
	const expired = $derived(link.expiresAt !== null && link.expiresAt <= Date.now());

	const facts = $derived(
		[
			link.expiresAt && {
				icon: Clock,
				label: expired ? 'Expired' : 'Expires',
				value: formatDateTime(link.expiresAt)
			},
			link.maxClicks && {
				icon: Gauge,
				label: 'Click limit',
				value: `${formatNumber(link.clickCount)} / ${formatNumber(link.maxClicks)}`
			},
			link.hasPassword && { icon: Lock, label: 'Password', value: 'Protected' },
			link.rules.length > 0 && {
				icon: Target,
				label: 'Targeting',
				value: `${link.rules.length} rule${link.rules.length === 1 ? '' : 's'}`
			},
			link.variants.length > 0 && {
				icon: SplitSquareHorizontal,
				label: 'Split test',
				value: `${link.variants.length} arms`
			},
			link.deepLink && {
				icon: Smartphone,
				label: 'Deep links',
				value: [link.deepLink.iosUrl && 'iOS', link.deepLink.androidUrl && 'Android']
					.filter(Boolean)
					.join(' · ')
			},
			(link.cloak?.enabled || link.hideReferrer) && {
				icon: EyeOff,
				label: 'Privacy',
				value: [link.cloak?.enabled && 'Cloaked', link.hideReferrer && 'Referrer hidden']
					.filter(Boolean)
					.join(' · ')
			},
			link.trackConversions && {
				icon: Target,
				label: 'Conversions',
				value: `${formatNumber(link.conversionCount)} recorded`
			}
		].filter(Boolean) as { icon: typeof Clock; label: string; value: string }[]
	);
</script>

<svelte:head><title>/{link.slug} · Links</title></svelte:head>

<div class="flex flex-col gap-6">
	<div>
		<a
			href="/"
			class="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm"
		>
			<ArrowLeft class="size-3.5" />
			All links
		</a>

		<div class="mt-3 flex flex-wrap items-start justify-between gap-4">
			<div class="min-w-0">
				<div class="flex items-center gap-2">
					<h1 class="truncate font-mono text-lg font-semibold tracking-tight">
						{link.shortUrl.replace(/^https?:\/\//, '')}
					</h1>
					<CopyButton value={link.shortUrl} label="Copy short link" variant="outline" />
					{#if link.archived}
						<Badge variant="secondary">Archived</Badge>
					{:else if !link.enabled}
						<Badge variant="secondary">Disabled</Badge>
					{:else if expired}
						<Badge variant="secondary">Expired</Badge>
					{:else}
						<Badge variant="outline" class="text-emerald-500">Active</Badge>
					{/if}
				</div>

				<a
					href={link.destination}
					target="_blank"
					rel="noreferrer noopener"
					class="text-muted-foreground hover:text-foreground mt-1.5 inline-flex items-center gap-1.5 text-sm"
				>
					{link.title ? `${link.title} · ` : ''}{prettyUrl(link.destination, 72)}
					<ExternalLink class="size-3.5" />
				</a>

				{#if link.tags.length > 0}
					<div class="mt-2 flex flex-wrap gap-1">
						{#each link.tags as tag (tag)}
							<Badge variant="outline" class="h-5 text-[11px] font-normal">{tag}</Badge>
						{/each}
					</div>
				{/if}
			</div>

			<div class="flex items-center gap-2">
				<Button variant="outline" size="sm" onclick={() => (qrOpen = true)}>
					<QrCode class="size-4" />
					QR
				</Button>

				<form method="POST" action="?/toggle" use:enhance>
					<input type="hidden" name="enabled" value={String(!link.enabled)} />
					<Button type="submit" variant="outline" size="sm">
						{link.enabled ? 'Disable' : 'Enable'}
					</Button>
				</form>

				<form method="POST" action="?/archive" use:enhance>
					<input type="hidden" name="archived" value={String(!link.archived)} />
					<Button type="submit" variant="outline" size="sm">
						{#if link.archived}
							<ArchiveRestore class="size-4" />
							Restore
						{:else}
							<Archive class="size-4" />
							Archive
						{/if}
					</Button>
				</form>

				<Button size="sm" onclick={() => (editOpen = true)}>
					<Pencil class="size-4" />
					Edit
				</Button>

				<Button
					variant="ghost"
					size="icon"
					class="text-muted-foreground hover:text-destructive size-8"
					aria-label="Delete link"
					onclick={() => (confirmingDelete = true)}
				>
					<Trash2 class="size-4" />
				</Button>
			</div>
		</div>

		{#if facts.length > 0 || link.description}
			<div class="border-border bg-card mt-4 rounded-xl border px-4 py-3">
				<div class="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
					{#each facts as fact (fact.label)}
						<span class="flex items-center gap-2">
							<fact.icon class="text-muted-foreground size-3.5" />
							<span class="text-muted-foreground">{fact.label}</span>
							<span class="font-medium">{fact.value}</span>
						</span>
					{/each}
				</div>
				{#if link.description}
					{#if facts.length > 0}<Separator class="my-3" />{/if}
					<p class="text-muted-foreground text-sm">{link.description}</p>
				{/if}
			</div>
		{/if}
	</div>

	<AnalyticsView
		analytics={data.analytics}
		recent={data.recent}
		conversions={data.conversions}
		bots={data.scope.bots}
	/>
</div>

<LinkDialog bind:open={editOpen} {link} domains={data.domains} folders={data.folders} />
<QrDialog bind:open={qrOpen} {link} saveAction="?/update" />

<AlertDialog.Root bind:open={confirmingDelete}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete /{link.slug}?</AlertDialog.Title>
			<AlertDialog.Description>
				The short link stops working immediately and its
				{formatNumber(link.clickCount)} recorded clicks are deleted. This cannot be undone —
				archive it instead if you only want it out of the way.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<form method="POST" action="?/delete" use:enhance>
				<button type="submit" class={buttonVariants({ variant: 'destructive' })}>Delete link</button>
			</form>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
