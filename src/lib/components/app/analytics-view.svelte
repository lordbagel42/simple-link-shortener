<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { MousePointerClick, Users, Bot, Globe } from '@lucide/svelte';
	import * as Select from '$lib/components/ui/select';
	import * as Tabs from '$lib/components/ui/tabs';
	import StatCard from './stat-card.svelte';
	import BarList from './bar-list.svelte';
	import ClicksChart from './clicks-chart.svelte';
	import ClickFeed from './click-feed.svelte';
	import { RANGES, type AnalyticsSummary, type RangeKey, type RecentClick } from '$lib/types';

	let {
		analytics,
		recent,
		range
	}: {
		analytics: AnalyticsSummary;
		recent: RecentClick[];
		range: RangeKey;
	} = $props();

	const rangeOptions = Object.entries(RANGES).map(([value, config]) => ({
		value,
		label: config.label
	}));

	function setRange(value: string | undefined) {
		if (!value) return;
		const url = new URL(page.url);
		url.searchParams.set('range', value);
		goto(`${url.pathname}${url.search}`, { noScroll: true });
	}

	const humanShare = $derived(
		analytics.totalClicks > 0
			? Math.round(((analytics.totalClicks - analytics.botClicks) / analytics.totalClicks) * 100)
			: 100
	);
</script>

<div class="flex flex-col gap-6">
	<div class="flex items-center justify-between gap-3">
		<h2 class="text-base font-medium">Traffic</h2>
		<Select.Root type="single" value={range} onValueChange={setRange}>
			<Select.Trigger class="w-[160px]">{RANGES[range].label}</Select.Trigger>
			<Select.Content>
				{#each rangeOptions as option (option.value)}
					<Select.Item value={option.value}>{option.label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
		<StatCard label="Clicks" value={analytics.totalClicks}>
			{#snippet icon()}<MousePointerClick class="size-3.5" />{/snippet}
		</StatCard>
		<StatCard label="Unique visitors" value={analytics.uniqueVisitors}>
			{#snippet icon()}<Users class="size-3.5" />{/snippet}
		</StatCard>
		<StatCard label="Human traffic" value="{humanShare}%" hint="{analytics.botClicks} bot clicks">
			{#snippet icon()}<Bot class="size-3.5" />{/snippet}
		</StatCard>
		<StatCard label="Countries" value={analytics.countries.length}>
			{#snippet icon()}<Globe class="size-3.5" />{/snippet}
		</StatCard>
	</div>

	<div class="border-border bg-card rounded-xl border p-4">
		<ClicksChart points={analytics.timeseries} />
	</div>

	<Tabs.Root value="audience">
		<Tabs.List>
			<Tabs.Trigger value="audience">Audience</Tabs.Trigger>
			<Tabs.Trigger value="technology">Technology</Tabs.Trigger>
			<Tabs.Trigger value="network">Network</Tabs.Trigger>
			<Tabs.Trigger value="events">Events</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="audience" class="mt-4">
			<div class="grid gap-3 lg:grid-cols-3">
				<BarList title="Countries" items={analytics.countries} flags />
				<BarList title="Cities" items={analytics.cities} />
				<BarList title="Referrers" items={analytics.referrers} />
			</div>
		</Tabs.Content>

		<Tabs.Content value="technology" class="mt-4">
			<div class="grid gap-3 lg:grid-cols-3">
				<BarList title="Devices" items={analytics.devices} />
				<BarList title="Browsers" items={analytics.browsers} />
				<BarList title="Operating systems" items={analytics.operatingSystems} />
			</div>
			<div class="mt-3 grid gap-3 lg:grid-cols-2">
				<BarList title="Languages" items={analytics.languages} />
				<BarList title="Destinations served" items={analytics.destinations} />
			</div>
		</Tabs.Content>

		<Tabs.Content value="network" class="mt-4">
			<div class="grid gap-3 lg:grid-cols-2">
				<BarList title="Cloudflare edge locations" items={analytics.colos} />
				<BarList title="Networks" items={analytics.networks} />
			</div>
		</Tabs.Content>

		<Tabs.Content value="events" class="mt-4">
			<ClickFeed clicks={recent} />
		</Tabs.Content>
	</Tabs.Root>
</div>
