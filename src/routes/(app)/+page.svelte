<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Plus, Search, Link2, MousePointerClick, Users, TrendingUp, X } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import * as Select from '$lib/components/ui/select';
	import StatCard from '$lib/components/app/stat-card.svelte';
	import LinkRow from '$lib/components/app/link-row.svelte';
	import LinkDialog from '$lib/components/app/link-dialog.svelte';
	import QrDialog from '$lib/components/app/qr-dialog.svelte';
	import type { SerializedLink } from '$lib/types';

	let { data } = $props();

	// Seeded once from the URL; the input owns the value from then on.
	// svelte-ignore state_referenced_locally
	let search = $state(data.filters.search ?? '');
	let editing = $state<SerializedLink | null>(null);
	let duplicating = $state(false);
	let dialogOpen = $state(false);
	let qrLink = $state<SerializedLink | null>(null);
	let qrOpen = $state(false);

	const sortOptions = [
		{ value: 'recent', label: 'Newest' },
		{ value: 'clicks', label: 'Most clicks' },
		{ value: 'slug', label: 'Alphabetical' }
	];
	const statusOptions = [
		{ value: 'all', label: 'All links' },
		{ value: 'active', label: 'Active' },
		{ value: 'inactive', label: 'Disabled' }
	];

	function setParam(key: string, value: string | null) {
		const url = new URL(page.url);
		if (value && value !== 'all' && value !== 'recent') url.searchParams.set(key, value);
		else url.searchParams.delete(key);
		goto(`${url.pathname}${url.search}`, { keepFocus: true, noScroll: true });
	}

	let searchTimer: ReturnType<typeof setTimeout>;
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => setParam('q', search.trim() || null), 250);
	}

	function openCreate() {
		editing = null;
		duplicating = false;
		dialogOpen = true;
	}

	function openEdit(link: SerializedLink) {
		editing = link;
		duplicating = false;
		dialogOpen = true;
	}

	function openDuplicate(link: SerializedLink) {
		editing = link;
		duplicating = true;
		dialogOpen = true;
	}

	function openQr(link: SerializedLink) {
		qrLink = link;
		qrOpen = true;
	}

	const filtering = $derived(
		Boolean(data.filters.search || data.filters.tag || data.filters.status !== 'all')
	);
</script>

<svelte:head><title>Links</title></svelte:head>

<div class="flex flex-col gap-6">
	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		<StatCard label="Links" value={data.stats.links}>
			{#snippet icon()}<Link2 class="size-3.5" />{/snippet}
		</StatCard>
		<StatCard label="Total clicks" value={data.stats.clicks}>
			{#snippet icon()}<MousePointerClick class="size-3.5" />{/snippet}
		</StatCard>
		<StatCard label="Unique visitors" value={data.stats.uniques}>
			{#snippet icon()}<Users class="size-3.5" />{/snippet}
		</StatCard>
		<StatCard label="Clicks · 7 days" value={data.stats.clicksThisWeek}>
			{#snippet icon()}<TrendingUp class="size-3.5" />{/snippet}
		</StatCard>
	</div>

	<div class="flex flex-wrap items-center gap-2">
		<div class="relative min-w-[200px] flex-1">
			<Search
				class="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
			/>
			<Input
				bind:value={search}
				oninput={onSearchInput}
				placeholder="Search links…"
				class="pl-9"
				aria-label="Search links"
			/>
		</div>

		<Select.Root
			type="single"
			value={data.filters.status ?? 'all'}
			onValueChange={(value) => setParam('status', value ?? null)}
		>
			<Select.Trigger class="w-[130px]">
				{statusOptions.find((o) => o.value === (data.filters.status ?? 'all'))?.label}
			</Select.Trigger>
			<Select.Content>
				{#each statusOptions as option (option.value)}
					<Select.Item value={option.value}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>

		<Select.Root
			type="single"
			value={data.filters.sort ?? 'recent'}
			onValueChange={(value) => setParam('sort', value ?? null)}
		>
			<Select.Trigger class="w-[140px]">
				{sortOptions.find((o) => o.value === (data.filters.sort ?? 'recent'))?.label}
			</Select.Trigger>
			<Select.Content>
				{#each sortOptions as option (option.value)}
					<Select.Item value={option.value}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>

		<Button onclick={openCreate}>
			<Plus class="size-4" />
			Create link
		</Button>
	</div>

	{#if data.tags.length > 0}
		<div class="flex flex-wrap items-center gap-1.5">
			{#each data.tags as tag (tag)}
				<button onclick={() => setParam('tag', data.filters.tag === tag ? null : tag)}>
					<Badge
						variant={data.filters.tag === tag ? 'default' : 'outline'}
						class="h-6 font-normal"
					>
						{tag}
						{#if data.filters.tag === tag}<X class="ml-1 size-3" />{/if}
					</Badge>
				</button>
			{/each}
		</div>
	{/if}

	<div class="border-border bg-card overflow-hidden rounded-xl border">
		{#if data.links.length === 0}
			<div class="flex flex-col items-center gap-3 px-6 py-16 text-center">
				<div class="bg-muted flex size-10 items-center justify-center rounded-full">
					<Link2 class="text-muted-foreground size-5" />
				</div>
				<div>
					<p class="text-sm font-medium">
						{filtering ? 'No links match those filters' : 'No links yet'}
					</p>
					<p class="text-muted-foreground mt-1 text-sm">
						{filtering
							? 'Try a different search or clear the filters.'
							: 'Create your first short link to start collecting analytics.'}
					</p>
				</div>
				{#if filtering}
					<Button variant="outline" size="sm" onclick={() => goto('/')}>Clear filters</Button>
				{:else}
					<Button size="sm" onclick={openCreate}>
						<Plus class="size-4" />
						Create link
					</Button>
				{/if}
			</div>
		{:else}
			{#each data.links as link (link.id)}
				<LinkRow
					{link}
					shortBase={data.shortBase}
					onedit={openEdit}
					onduplicate={openDuplicate}
					onqr={openQr}
				/>
			{/each}
		{/if}
	</div>

	{#if data.links.length > 0}
		<p class="text-muted-foreground text-xs">
			Showing {data.links.length} of {data.total}
			{data.total === 1 ? 'link' : 'links'}.
		</p>
	{/if}
</div>

<LinkDialog
	bind:open={dialogOpen}
	link={editing}
	duplicate={duplicating}
	shortBase={data.shortBase}
/>

{#if qrLink}
	<QrDialog bind:open={qrOpen} url="{data.shortBase}/{qrLink.slug}" slug={qrLink.slug} />
{/if}
