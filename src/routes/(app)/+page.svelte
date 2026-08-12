<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		Archive,
		ArchiveRestore,
		Clock,
		Download,
		FolderIcon,
		Link2,
		MousePointerClick,
		Plus,
		Search,
		Target,
		Trash2,
		TrendingUp,
		Upload,
		Users,
		X
	} from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Select from '$lib/components/ui/select';
	import StatCard from '$lib/components/app/stat-card.svelte';
	import LinkRow from '$lib/components/app/link-row.svelte';
	import LinkDialog from '$lib/components/app/link-dialog.svelte';
	import QrDialog from '$lib/components/app/qr-dialog.svelte';
	import ImportDialog from '$lib/components/app/import-dialog.svelte';
	import { formatCount, timeAgo } from '$lib/format';
	import { toast } from 'svelte-sonner';
	import type { SerializedLink } from '$lib/types';

	let { data } = $props();

	// Seeded once from the URL; the input owns the value from then on.
	// svelte-ignore state_referenced_locally
	let search = $state(data.filters.search ?? '');
	let editing = $state<SerializedLink | null>(null);
	let dialogOpen = $state(false);
	let qrLink = $state<SerializedLink | null>(null);
	let qrOpen = $state(false);
	let importOpen = $state(false);
	let selection = $state<string[]>([]);
	let bulkTags = $state('');

	const sortOptions = [
		{ value: 'recent', label: 'Newest' },
		{ value: 'oldest', label: 'Oldest' },
		{ value: 'clicks', label: 'Most clicks' },
		{ value: 'conversions', label: 'Most conversions' },
		{ value: 'slug', label: 'Alphabetical' }
	];
	const statusOptions = [
		{ value: 'all', label: 'All links' },
		{ value: 'active', label: 'Active' },
		{ value: 'inactive', label: 'Disabled' },
		{ value: 'expiring', label: 'Has limits' },
		{ value: 'archived', label: 'Archived' }
	];

	const foldersById = $derived(new Map(data.folders.map((folder) => [folder.id, folder])));

	function setParam(key: string, value: string | null) {
		const url = new URL(page.url);
		if (value && value !== 'all' && value !== 'recent') url.searchParams.set(key, value);
		else url.searchParams.delete(key);
		selection = [];
		goto(`${url.pathname}${url.search}`, { keepFocus: true, noScroll: true });
	}

	let searchTimer: ReturnType<typeof setTimeout>;
	function onSearchInput() {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => setParam('q', search.trim() || null), 250);
	}

	function openCreate() {
		editing = null;
		dialogOpen = true;
	}

	function openEdit(link: SerializedLink) {
		editing = link;
		dialogOpen = true;
	}

	function openQr(link: SerializedLink) {
		qrLink = link;
		qrOpen = true;
	}

	function toggleSelect(id: string, checked: boolean) {
		selection = checked ? [...selection, id] : selection.filter((value) => value !== id);
	}

	const allSelected = $derived(
		data.links.length > 0 && selection.length === data.links.length
	);

	function toggleAll(checked: boolean) {
		selection = checked ? data.links.map((link) => link.id) : [];
	}

	/** Bulk forms post the selection as one comma-joined `ids` field. */
	const ids = $derived(selection.join(','));

	const showingArchived = $derived(data.filters.status === 'archived');
	const filtering = $derived(
		Boolean(
			data.filters.search ||
				data.filters.tag ||
				data.filters.folderId ||
				data.filters.domainId ||
				(data.filters.status && data.filters.status !== 'all')
		)
	);

	/** The links export inherits whatever filters the list is showing. */
	const exportHref = $derived(`/api/v1/links/export${page.url.search}`);

	function afterBulk(message: string) {
		return async ({ update }: { update: () => Promise<void> }) => {
			toast.success(message);
			selection = [];
			bulkTags = '';
			await update();
		};
	}
</script>

<svelte:head><title>Links</title></svelte:head>

<div class="flex flex-col gap-6">
	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
		<StatCard label="Links" value={data.stats.links}>
			{#snippet icon()}<Link2 class="size-3.5" />{/snippet}
		</StatCard>
		<StatCard label="Total clicks" value={data.stats.clicks}>
			{#snippet icon()}<MousePointerClick class="size-3.5" />{/snippet}
		</StatCard>
		<StatCard label="Unique visitors" value={data.stats.uniques}>
			{#snippet icon()}<Users class="size-3.5" />{/snippet}
		</StatCard>
		<StatCard label="Conversions" value={data.stats.conversions}>
			{#snippet icon()}<Target class="size-3.5" />{/snippet}
		</StatCard>
		<StatCard label="Clicks · 7 days" value={data.stats.clicksThisWeek}>
			{#snippet icon()}<TrendingUp class="size-3.5" />{/snippet}
		</StatCard>
	</div>

	{#if data.expiring.length > 0}
		<div class="border-border bg-card flex flex-wrap items-center gap-2 rounded-xl border px-4 py-3">
			<Clock class="text-muted-foreground size-4 shrink-0" />
			<span class="text-sm">Ending soon:</span>
			{#each data.expiring as row (row.id)}
				<a href="/links/{row.id}" class="hover:underline">
					<Badge variant="outline" class="h-6 font-mono text-[11px] font-normal">
						/{row.slug}
						<span class="text-muted-foreground ml-1.5">
							{#if row.expiresAt}
								{timeAgo(row.expiresAt)}
							{:else if row.maxClicks}
								{formatCount(row.clickCount)}/{formatCount(row.maxClicks)}
							{/if}
						</span>
					</Badge>
				</a>
			{/each}
		</div>
	{/if}

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

		{#if data.domains.length > 1}
			<Select.Root
				type="single"
				value={data.filters.domainId ?? 'all'}
				onValueChange={(value) => setParam('domain', value ?? null)}
			>
				<Select.Trigger class="w-[170px] font-mono text-xs">
					{data.domains.find((domain) => domain.id === data.filters.domainId)?.hostname ??
						'All domains'}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all">All domains</Select.Item>
					{#each data.domains as domain (domain.id)}
						<Select.Item value={domain.id}>{domain.hostname}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}

		{#if data.folders.length > 0}
			<Select.Root
				type="single"
				value={data.filters.folderId ?? 'all'}
				onValueChange={(value) => setParam('folder', value ?? null)}
			>
				<Select.Trigger class="w-[150px]">
					{foldersById.get(data.filters.folderId ?? '')?.name ?? 'All folders'}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all">All folders</Select.Item>
					{#each data.folders as folder (folder.id)}
						<Select.Item value={folder.id}>{folder.name} ({folder.linkCount})</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}

		<Select.Root
			type="single"
			value={data.filters.status ?? 'all'}
			onValueChange={(value) => setParam('status', value ?? null)}
		>
			<Select.Trigger class="w-[130px]">
				{statusOptions.find((option) => option.value === (data.filters.status ?? 'all'))?.label}
			</Select.Trigger>
			<Select.Content>
				{#each statusOptions as option (option.value)}
					<Select.Item value={option.value}>
						{option.label}{option.value === 'archived' && data.archivedCount
							? ` (${data.archivedCount})`
							: ''}
					</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>

		<Select.Root
			type="single"
			value={data.filters.sort ?? 'recent'}
			onValueChange={(value) => setParam('sort', value ?? null)}
		>
			<Select.Trigger class="w-[160px]">
				{sortOptions.find((option) => option.value === (data.filters.sort ?? 'recent'))?.label}
			</Select.Trigger>
			<Select.Content>
				{#each sortOptions as option (option.value)}
					<Select.Item value={option.value}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>

		<Button variant="outline" size="icon" href={exportHref} aria-label="Export links as CSV">
			<Download class="size-4" />
		</Button>
		<Button variant="outline" size="icon" onclick={() => (importOpen = true)} aria-label="Import links">
			<Upload class="size-4" />
		</Button>

		<Button onclick={openCreate}>
			<Plus class="size-4" />
			Create link
		</Button>
	</div>

	{#if data.tags.length > 0}
		<div class="flex flex-wrap items-center gap-1.5">
			{#each data.tags as tag (tag)}
				<button onclick={() => setParam('tag', data.filters.tag === tag ? null : tag)}>
					<Badge variant={data.filters.tag === tag ? 'default' : 'outline'} class="h-6 font-normal">
						{tag}
						{#if data.filters.tag === tag}<X class="ml-1 size-3" />{/if}
					</Badge>
				</button>
			{/each}
		</div>
	{/if}

	{#if selection.length > 0}
		<div
			class="border-border bg-card sticky top-[4.75rem] z-30 flex flex-wrap items-center gap-2 rounded-xl border px-4 py-2.5 shadow-sm"
		>
			<span class="text-sm font-medium">{selection.length} selected</span>
			<Button variant="ghost" size="sm" onclick={() => (selection = [])}>Clear</Button>

			<div class="ml-auto flex flex-wrap items-center gap-2">
				<form method="POST" action="?/bulkTag" use:enhance={() => afterBulk('Tags updated')}>
					<input type="hidden" name="ids" value={ids} />
					<div class="flex items-center gap-1.5">
						<Input
							name="add"
							bind:value={bulkTags}
							placeholder="Add tags…"
							class="h-8 w-[150px] text-xs"
						/>
						<Button type="submit" variant="outline" size="sm" disabled={!bulkTags.trim()}>
							Apply
						</Button>
					</div>
				</form>

				{#if data.folders.length > 0}
					<form method="POST" action="?/bulkFolder" use:enhance={() => afterBulk('Links moved')}>
						<input type="hidden" name="ids" value={ids} />
						<select
							name="folderId"
							class="border-border bg-background h-8 rounded-md border px-2 text-xs"
							onchange={(event) => event.currentTarget.form?.requestSubmit()}
						>
							<option value="">Move to folder…</option>
							<option value="">No folder</option>
							{#each data.folders as folder (folder.id)}
								<option value={folder.id}>{folder.name}</option>
							{/each}
						</select>
					</form>
				{/if}

				<form
					method="POST"
					action="?/bulkArchive"
					use:enhance={() => afterBulk(showingArchived ? 'Links restored' : 'Links archived')}
				>
					<input type="hidden" name="ids" value={ids} />
					<input type="hidden" name="archived" value={String(!showingArchived)} />
					<Button type="submit" variant="outline" size="sm">
						{#if showingArchived}
							<ArchiveRestore class="size-4" />
							Restore
						{:else}
							<Archive class="size-4" />
							Archive
						{/if}
					</Button>
				</form>

				<form method="POST" action="?/bulkDelete" use:enhance={() => afterBulk('Links deleted')}>
					<input type="hidden" name="ids" value={ids} />
					<Button type="submit" variant="outline" size="sm" class="text-destructive">
						<Trash2 class="size-4" />
						Delete
					</Button>
				</form>
			</div>
		</div>
	{/if}

	<div class="border-border bg-card overflow-hidden rounded-xl border">
		{#if data.links.length === 0}
			<div class="flex flex-col items-center gap-3 px-6 py-16 text-center">
				<div class="bg-muted flex size-10 items-center justify-center rounded-full">
					{#if showingArchived}
						<Archive class="text-muted-foreground size-5" />
					{:else}
						<Link2 class="text-muted-foreground size-5" />
					{/if}
				</div>
				<div>
					<p class="text-sm font-medium">
						{showingArchived
							? 'Nothing archived'
							: filtering
								? 'No links match those filters'
								: 'No links yet'}
					</p>
					<p class="text-muted-foreground mt-1 text-sm">
						{showingArchived
							? 'Archived links stay out of the list but keep resolving.'
							: filtering
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
			<div class="border-border text-muted-foreground flex items-center gap-3 border-b px-4 py-2 text-xs">
				<Checkbox
					checked={allSelected}
					onCheckedChange={(checked) => toggleAll(checked === true)}
					aria-label="Select all links on this page"
				/>
				<span>{allSelected ? 'All on this page selected' : 'Select all'}</span>
				{#if data.filters.folderId}
					<span class="ml-auto flex items-center gap-1.5">
						<FolderIcon class="size-3.5" />
						{foldersById.get(data.filters.folderId)?.name}
					</span>
				{/if}
			</div>

			{#each data.links as link (link.id)}
				<LinkRow
					{link}
					folder={link.folderId ? (foldersById.get(link.folderId) ?? null) : null}
					selected={selection.includes(link.id)}
					onselect={toggleSelect}
					onedit={openEdit}
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

<LinkDialog bind:open={dialogOpen} link={editing} domains={data.domains} folders={data.folders} />
<QrDialog bind:open={qrOpen} link={qrLink} saveAction="?/update" />
<ImportDialog bind:open={importOpen} domains={data.domains} />
