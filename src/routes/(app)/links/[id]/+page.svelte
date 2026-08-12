<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		ArrowLeft,
		ExternalLink,
		Pencil,
		Copy,
		QrCode,
		Trash2,
		Lock,
		Clock,
		Gauge,
		Target,
		Share2
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
	let duplicateOpen = $state(false);
	let qrOpen = $state(false);
	let confirmingDelete = $state(false);

	const shortUrl = $derived(`${data.shortBase}/${data.link.slug}`);
	const expired = $derived(data.link.expiresAt !== null && data.link.expiresAt <= Date.now());

	const facts = $derived(
		[
			data.link.expiresAt && {
				icon: Clock,
				label: expired ? 'Expired' : 'Expires',
				value: formatDateTime(data.link.expiresAt)
			},
			data.link.maxClicks && {
				icon: Gauge,
				label: 'Click limit',
				value: `${formatNumber(data.link.clickCount)} / ${formatNumber(data.link.maxClicks)}`
			},
			data.link.hasPassword && { icon: Lock, label: 'Password', value: 'Protected' },
			data.link.rules.length > 0 && {
				icon: Target,
				label: 'Targeting',
				value: `${data.link.rules.length} rule${data.link.rules.length === 1 ? '' : 's'}`
			},
			{
				icon: Share2,
				label: 'Unfurls as',
				value:
					data.link.previewMode === 'target'
						? "The destination's card"
						: data.link.previewMode === 'branded'
							? 'A card of your own'
							: 'No preview page'
			}
		].filter(Boolean) as { icon: typeof Clock; label: string; value: string }[]
	);
</script>

<svelte:head><title>/{data.link.slug} · Links</title></svelte:head>

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
						{data.shortBase.replace(/^https?:\/\//, '')}/{data.link.slug}
					</h1>
					<CopyButton value={shortUrl} label="Copy short link" variant="outline" />
					{#if !data.link.enabled}
						<Badge variant="secondary">Disabled</Badge>
					{:else if expired}
						<Badge variant="secondary">Expired</Badge>
					{:else}
						<Badge variant="outline" class="text-emerald-500">Active</Badge>
					{/if}
				</div>

				<a
					href={data.link.destination}
					target="_blank"
					rel="noreferrer noopener"
					class="text-muted-foreground hover:text-foreground mt-1.5 inline-flex items-center gap-1.5 text-sm"
				>
					{data.link.title ? `${data.link.title} · ` : ''}{prettyUrl(data.link.destination, 72)}
					<ExternalLink class="size-3.5" />
				</a>

				{#if data.link.aliases.length > 0}
					<div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
						<span class="text-muted-foreground text-xs">Also answers to</span>
						{#each data.link.aliases as alias (alias)}
							<span class="flex items-center gap-1">
								<a
									href="{data.shortBase}/{alias}"
									target="_blank"
									rel="noreferrer noopener"
									class="font-mono text-xs hover:underline"
								>
									/{alias}
								</a>
								<CopyButton value="{data.shortBase}/{alias}" label="Copy {alias}" />
							</span>
						{/each}
					</div>
				{/if}

				{#if data.link.tags.length > 0}
					<div class="mt-2 flex flex-wrap gap-1">
						{#each data.link.tags as tag (tag)}
							<Badge variant="outline" class="h-5 text-[11px] font-normal">{tag}</Badge>
						{/each}
					</div>
				{/if}
			</div>

			<div class="flex items-center gap-2">
				<Button variant="outline" size="sm" onclick={() => (duplicateOpen = true)}>
					<Copy class="size-4" />
					Duplicate
				</Button>

				<Button variant="outline" size="sm" onclick={() => (qrOpen = true)}>
					<QrCode class="size-4" />
					QR
				</Button>

				<form method="POST" action="?/toggle" use:enhance>
					<input type="hidden" name="enabled" value={String(!data.link.enabled)} />
					<Button type="submit" variant="outline" size="sm">
						{data.link.enabled ? 'Disable' : 'Enable'}
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

		{#if facts.length > 0 || data.link.description}
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
				{#if data.link.description}
					{#if facts.length > 0}<Separator class="my-3" />{/if}
					<p class="text-muted-foreground text-sm">{data.link.description}</p>
				{/if}
			</div>
		{/if}
	</div>

	<AnalyticsView analytics={data.analytics} recent={data.recent} range={data.range} />
</div>

<LinkDialog bind:open={editOpen} link={data.link} shortBase={data.shortBase} />
<LinkDialog bind:open={duplicateOpen} link={data.link} duplicate shortBase={data.shortBase} />
<QrDialog bind:open={qrOpen} url={shortUrl} slug={data.link.slug} />

<AlertDialog.Root bind:open={confirmingDelete}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete /{data.link.slug}?</AlertDialog.Title>
			<AlertDialog.Description>
				The short link stops working immediately and its
				{formatNumber(data.link.clickCount)} recorded clicks are deleted. This cannot be undone.
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
