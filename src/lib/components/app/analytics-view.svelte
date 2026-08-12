<script lang="ts">
	import { page } from '$app/state';
	import {
		Bot,
		Download,
		Gauge,
		MousePointerClick,
		QrCode,
		Target,
		Users
	} from '@lucide/svelte';
	import * as Tabs from '$lib/components/ui/tabs';
	import { Button } from '$lib/components/ui/button';
	import StatCard from './stat-card.svelte';
	import BarList from './bar-list.svelte';
	import ClicksChart from './clicks-chart.svelte';
	import ClickFeed from './click-feed.svelte';
	import Heatmap from './heatmap.svelte';
	import RangePicker from './range-picker.svelte';
	import { formatCount, formatNumber, timeAgo } from '$lib/format';
	import type { AnalyticsSummary, RecentClick, SerializedConversion } from '$lib/types';

	let {
		analytics,
		recent,
		conversions = [],
		bots = 'all'
	}: {
		analytics: AnalyticsSummary;
		recent: RecentClick[];
		conversions?: SerializedConversion[];
		bots?: 'all' | 'exclude' | 'only';
	} = $props();

	const totals = $derived(analytics.totals);
	const previous = $derived(analytics.previous);
	const breakdowns = $derived(analytics.breakdowns);

	const humanShare = $derived(
		totals.clicks > 0 ? Math.round(((totals.clicks - totals.bots) / totals.clicks) * 100) : 100
	);
	const conversionRate = $derived(
		totals.clicks > 0 ? (totals.conversions / totals.clicks) * 100 : 0
	);

	/** The CSV export inherits whatever scope and window the page is showing. */
	const exportHref = $derived(`/api/v1/analytics/export${page.url.search || '?range=7d'}`);

	const currency = $derived(conversions[0]?.currency ?? 'USD');
	const money = $derived(
		new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 })
	);
</script>

<div class="flex flex-col gap-6">
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h2 class="text-base font-medium">Traffic</h2>
		<div class="flex flex-wrap items-center gap-2">
			<RangePicker window={analytics.window} {bots} />
			<Button variant="outline" size="icon" href={exportHref} aria-label="Export clicks as CSV">
				<Download class="size-4" />
			</Button>
		</div>
	</div>

	<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
		<StatCard label="Clicks" value={totals.clicks} previous={previous.clicks}>
			{#snippet icon()}<MousePointerClick class="size-3.5" />{/snippet}
		</StatCard>
		<StatCard label="Unique visitors" value={totals.uniques} previous={previous.uniques}>
			{#snippet icon()}<Users class="size-3.5" />{/snippet}
		</StatCard>
		<StatCard
			label="Conversions"
			value={totals.conversions}
			previous={previous.conversions}
			hint={totals.conversions > 0
				? `${conversionRate.toFixed(1)}% of clicks · ${money.format(totals.conversionValue)}`
				: 'No conversions reported'}
		>
			{#snippet icon()}<Target class="size-3.5" />{/snippet}
		</StatCard>
		<StatCard
			label="Human traffic"
			value="{humanShare}%"
			hint="{formatNumber(totals.bots)} bot clicks"
		>
			{#snippet icon()}<Bot class="size-3.5" />{/snippet}
		</StatCard>
		<StatCard
			label="QR scans"
			value={totals.qrScans}
			previous={previous.qrScans}
			hint="{totals.avgProcessingMs}ms average at the edge"
		>
			{#snippet icon()}<QrCode class="size-3.5" />{/snippet}
		</StatCard>
	</div>

	<div class="border-border bg-card rounded-xl border p-4">
		<ClicksChart points={analytics.timeseries} />
	</div>

	<Tabs.Root value="geography">
		<Tabs.List class="flex-wrap">
			<Tabs.Trigger value="geography">Geography</Tabs.Trigger>
			<Tabs.Trigger value="technology">Technology</Tabs.Trigger>
			<Tabs.Trigger value="network">Network</Tabs.Trigger>
			<Tabs.Trigger value="sources">Sources</Tabs.Trigger>
			<Tabs.Trigger value="routing">Routing</Tabs.Trigger>
			<Tabs.Trigger value="behaviour">Behaviour</Tabs.Trigger>
			<Tabs.Trigger value="conversions">Conversions</Tabs.Trigger>
			<Tabs.Trigger value="events">Events</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="geography" class="mt-4">
			<div class="grid gap-3 lg:grid-cols-3">
				<BarList title="Countries" items={breakdowns.countries} flags />
				<BarList title="Regions" items={breakdowns.regions} />
				<BarList title="Cities" items={breakdowns.cities} />
			</div>
			<div class="mt-3 grid gap-3 lg:grid-cols-3">
				<BarList title="Continents" items={breakdowns.continents} />
				<BarList title="Time zones" items={breakdowns.timezones} />
				<BarList title="Languages" items={breakdowns.languages} />
			</div>
		</Tabs.Content>

		<Tabs.Content value="technology" class="mt-4">
			<div class="grid gap-3 lg:grid-cols-3">
				<BarList title="Devices" items={breakdowns.devices} />
				<BarList title="Browsers" items={breakdowns.browsers} />
				<BarList title="Operating systems" items={breakdowns.operatingSystems} />
			</div>
			<div class="mt-3 grid gap-3 lg:grid-cols-3">
				<BarList title="Browser versions" items={breakdowns.browserVersions} />
				<BarList title="OS versions" items={breakdowns.osVersions} />
				<BarList title="Rendering engines" items={breakdowns.engines} />
			</div>
			<div class="mt-3 grid gap-3 lg:grid-cols-3">
				<BarList title="Device vendors" items={breakdowns.deviceVendors} />
				<BarList title="Device models" items={breakdowns.deviceModels} />
				<BarList title="Reported platforms" items={breakdowns.platforms} />
			</div>
		</Tabs.Content>

		<Tabs.Content value="network" class="mt-4">
			<div class="grid gap-3 lg:grid-cols-3">
				<BarList title="Cloudflare edge locations" items={breakdowns.colos} />
				<BarList title="Networks" items={breakdowns.networks} />
				<BarList title="Autonomous systems" items={breakdowns.asns} />
			</div>
			<div class="mt-3 grid gap-3 lg:grid-cols-4">
				<BarList title="TLS versions" items={breakdowns.tlsVersions} />
				<BarList title="HTTP protocols" items={breakdowns.httpProtocols} />
				<BarList title="IP versions" items={breakdowns.ipVersions} />
				<BarList title="Verified bots" items={breakdowns.botCategories} />
			</div>
		</Tabs.Content>

		<Tabs.Content value="sources" class="mt-4">
			<div class="grid gap-3 lg:grid-cols-3">
				<BarList title="Referrers" items={breakdowns.referrers} />
				<BarList title="Referring pages" items={breakdowns.refererPaths} />
				<BarList title="Ad networks" items={breakdowns.adNetworks} />
			</div>
			<div class="mt-3 grid gap-3 lg:grid-cols-3">
				<BarList title="utm_source" items={breakdowns.utmSources} />
				<BarList title="utm_medium" items={breakdowns.utmMediums} />
				<BarList title="utm_campaign" items={breakdowns.utmCampaigns} />
			</div>
			<div class="mt-3 grid gap-3 lg:grid-cols-2">
				<BarList title="utm_term" items={breakdowns.utmTerms} />
				<BarList title="utm_content" items={breakdowns.utmContents} />
			</div>
		</Tabs.Content>

		<Tabs.Content value="routing" class="mt-4">
			<div class="grid gap-3 lg:grid-cols-3">
				<BarList title="Destinations served" items={breakdowns.destinations} />
				<BarList title="Split-test arms" items={breakdowns.variants} />
				<BarList title="Targeting rules hit" items={breakdowns.rules} />
			</div>
			<div class="mt-3 grid gap-3 lg:grid-cols-3">
				<BarList title="Short links" items={breakdowns.slugs} />
				<BarList title="Hostnames" items={breakdowns.hostnames} />
				<BarList title="Response codes" items={breakdowns.statuses} />
			</div>
		</Tabs.Content>

		<Tabs.Content value="behaviour" class="mt-4 flex flex-col gap-3">
			<Heatmap cells={analytics.heatmap} />
			<div class="grid gap-3 lg:grid-cols-2">
				<BarList title="Navigation context" items={breakdowns.secFetchSites} />
				<div class="border-border bg-card flex flex-col rounded-xl border">
					<div class="border-border border-b px-4 py-3">
						<h3 class="text-sm font-medium">Visitor mix</h3>
					</div>
					<dl class="divide-border divide-y text-sm">
						<div class="flex items-center justify-between px-4 py-2.5">
							<dt class="text-muted-foreground">New visitors</dt>
							<dd class="tabular-nums">{formatNumber(totals.uniques)}</dd>
						</div>
						<div class="flex items-center justify-between px-4 py-2.5">
							<dt class="text-muted-foreground">Returning clicks</dt>
							<dd class="tabular-nums">
								{formatNumber(Math.max(0, totals.clicks - totals.uniques))}
							</dd>
						</div>
						<div class="flex items-center justify-between px-4 py-2.5">
							<dt class="text-muted-foreground">QR scans</dt>
							<dd class="tabular-nums">{formatNumber(totals.qrScans)}</dd>
						</div>
						<div class="flex items-center justify-between px-4 py-2.5">
							<dt class="text-muted-foreground">Links with traffic</dt>
							<dd class="tabular-nums">{formatNumber(totals.activeLinks)}</dd>
						</div>
						<div class="flex items-center justify-between px-4 py-2.5">
							<dt class="text-muted-foreground">Average edge time</dt>
							<dd class="tabular-nums">{totals.avgProcessingMs}ms</dd>
						</div>
					</dl>
				</div>
			</div>
		</Tabs.Content>

		<Tabs.Content value="conversions" class="mt-4">
			<div class="grid gap-3 lg:grid-cols-2">
				<BarList
					title="Conversion events"
					items={analytics.conversionEvents}
					emptyLabel="Nothing reported yet"
				/>

				<div class="border-border bg-card flex flex-col rounded-xl border">
					<div class="border-border flex items-center justify-between border-b px-4 py-3">
						<h3 class="text-sm font-medium">Recent conversions</h3>
						<span class="text-muted-foreground text-xs tabular-nums">
							{formatCount(totals.conversions)}
						</span>
					</div>
					{#if conversions.length === 0}
						<p class="text-muted-foreground px-4 py-10 text-center text-sm">
							Turn on conversion tracking for a link, then post its
							<code class="font-mono">clid</code> back to
							<code class="font-mono">/api/v1/conversions</code>.
						</p>
					{:else}
						<div class="divide-border divide-y">
							{#each conversions as row (row.id)}
								<div class="flex items-center gap-3 px-4 py-2.5 text-sm">
									<span class="min-w-0 flex-1 truncate">
										<span class="font-medium">{row.event}</span>
										{#if row.slug}
											<span class="text-muted-foreground font-mono text-xs"> /{row.slug}</span>
										{/if}
									</span>
									{#if row.value > 0}
										<span class="tabular-nums">{money.format(row.value)}</span>
									{/if}
									<span class="text-muted-foreground shrink-0 text-xs">
										{timeAgo(row.timestamp)}
									</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</Tabs.Content>

		<Tabs.Content value="events" class="mt-4">
			<ClickFeed clicks={recent} />
		</Tabs.Content>
	</Tabs.Root>
</div>
