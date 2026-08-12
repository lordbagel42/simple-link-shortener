<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import * as Select from '$lib/components/ui/select';
	import AnalyticsView from '$lib/components/app/analytics-view.svelte';
	import { formatCount } from '$lib/format';

	let { data } = $props();

	function setDomain(value: string | undefined) {
		const url = new URL(page.url);
		if (!value || value === 'all') url.searchParams.delete('domain');
		else url.searchParams.set('domain', value);
		goto(`${url.pathname}${url.search}`, { noScroll: true });
	}
</script>

<svelte:head><title>Analytics · Links</title></svelte:head>

<div class="mb-6 flex flex-wrap items-end justify-between gap-3">
	<div>
		<h1 class="text-lg font-semibold tracking-tight">Analytics</h1>
		<p class="text-muted-foreground mt-1 text-sm">Every click across all of your short links.</p>
	</div>

	{#if data.domains.length > 1}
		<Select.Root type="single" value={data.scope.domainId ?? 'all'} onValueChange={setDomain}>
			<Select.Trigger class="w-[190px] font-mono text-xs">
				{data.domains.find((domain) => domain.id === data.scope.domainId)?.hostname ??
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
</div>

{#if data.topLinks.length > 0}
	<div class="border-border bg-card mb-6 overflow-hidden rounded-xl border">
		<div class="border-border border-b px-4 py-3">
			<h2 class="text-sm font-medium">Busiest links in this period</h2>
		</div>
		<div class="divide-border divide-y">
			{#each data.topLinks as row (row.linkId)}
				<a
					href="/links/{row.linkId}"
					class="hover:bg-muted/40 flex items-center gap-3 px-4 py-2.5 text-sm transition-colors"
				>
					<span class="min-w-0 flex-1 truncate font-mono text-xs">/{row.slug ?? '—'}</span>
					<span class="tabular-nums">{formatCount(row.clicks)}</span>
					<span class="text-muted-foreground w-24 text-right text-xs tabular-nums">
						{formatCount(row.uniques)} unique
					</span>
				</a>
			{/each}
		</div>
	</div>
{/if}

<AnalyticsView
	analytics={data.analytics}
	recent={data.recent}
	conversions={data.conversions}
	bots={data.scope.bots}
/>
