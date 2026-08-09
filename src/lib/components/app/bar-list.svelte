<script lang="ts">
	import { formatCount } from '$lib/format';
	import { countryFlag } from '$lib/format';
	import type { Breakdown } from '$lib/types';

	let {
		title,
		items,
		emptyLabel = 'No data yet',
		flags = false,
		limit = 8
	}: {
		title: string;
		items: Breakdown[];
		emptyLabel?: string;
		flags?: boolean;
		limit?: number;
	} = $props();

	const shown = $derived(items.slice(0, limit));
	const max = $derived(Math.max(1, ...shown.map((item) => item.count)));
	const total = $derived(items.reduce((sum, item) => sum + item.count, 0));
</script>

<div class="border-border bg-card flex flex-col rounded-xl border">
	<div class="border-border flex items-center justify-between border-b px-4 py-3">
		<h3 class="text-sm font-medium">{title}</h3>
		<span class="text-muted-foreground text-xs tabular-nums">{formatCount(total)}</span>
	</div>

	{#if shown.length === 0}
		<p class="text-muted-foreground px-4 py-8 text-center text-sm">{emptyLabel}</p>
	{:else}
		<ul class="flex flex-col gap-1 p-2">
			{#each shown as item (item.key)}
				<li class="group relative flex items-center justify-between rounded-md px-2 py-1.5">
					<div
						class="bg-muted absolute inset-y-0 left-0 rounded-md transition-all"
						style="width: {(item.count / max) * 100}%"
					></div>
					<span class="relative z-10 flex min-w-0 items-center gap-2 text-sm">
						{#if flags}<span aria-hidden="true">{countryFlag(item.key)}</span>{/if}
						<span class="truncate">{item.label}</span>
					</span>
					<span class="text-muted-foreground relative z-10 pl-3 text-xs tabular-nums">
						{formatCount(item.count)}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</div>
