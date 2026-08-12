<script lang="ts">
	import { formatNumber } from '$lib/format';
	import type { HeatCell } from '$lib/types';

	let { cells }: { cells: HeatCell[] } = $props();

	// SQLite's `strftime('%w')` counts from Sunday; the grid reads better
	// starting on Monday, so the rows are reordered rather than the query.
	const DAYS = [
		{ index: 1, label: 'Mon' },
		{ index: 2, label: 'Tue' },
		{ index: 3, label: 'Wed' },
		{ index: 4, label: 'Thu' },
		{ index: 5, label: 'Fri' },
		{ index: 6, label: 'Sat' },
		{ index: 0, label: 'Sun' }
	];

	const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

	const lookup = $derived(
		new Map(cells.map((cell) => [`${cell.weekday}:${cell.hour}`, cell.clicks]))
	);
	const max = $derived(Math.max(1, ...cells.map((cell) => cell.clicks)));
	const total = $derived(cells.reduce((sum, cell) => sum + cell.clicks, 0));

	function count(weekday: number, hour: number): number {
		return lookup.get(`${weekday}:${hour}`) ?? 0;
	}

	/**
	 * A square-root ramp rather than a linear one: click distributions are long
	 * tailed, and one runaway hour would otherwise flatten everything else to
	 * the same shade of nothing.
	 */
	function intensity(value: number): number {
		return value === 0 ? 0 : 0.12 + Math.sqrt(value / max) * 0.88;
	}
</script>

<div class="border-border bg-card flex flex-col rounded-xl border">
	<div class="border-border flex items-center justify-between border-b px-4 py-3">
		<div>
			<h3 class="text-sm font-medium">When people click</h3>
			<p class="text-muted-foreground mt-0.5 text-xs">Hour of day by weekday, in UTC.</p>
		</div>
		<span class="text-muted-foreground text-xs tabular-nums">{formatNumber(total)}</span>
	</div>

	{#if total === 0}
		<p class="text-muted-foreground px-4 py-10 text-center text-sm">No clicks in this period.</p>
	{:else}
		<div class="overflow-x-auto p-4">
			<div class="min-w-[560px]">
				<div class="grid gap-1" style="grid-template-columns: 2.25rem repeat(24, 1fr)">
					<span></span>
					{#each HOURS as hour (hour)}
						<span class="text-muted-foreground text-center text-[9px] tabular-nums">
							{hour % 6 === 0 ? hour : ''}
						</span>
					{/each}

					{#each DAYS as day (day.index)}
						<span class="text-muted-foreground self-center text-[10px]">{day.label}</span>
						{#each HOURS as hour (hour)}
							{@const value = count(day.index, hour)}
							<div
								class="bg-foreground aspect-square rounded-[3px]"
								style="opacity: {intensity(value)}"
								title="{day.label} {String(hour).padStart(2, '0')}:00 — {formatNumber(value)} clicks"
							></div>
						{/each}
					{/each}
				</div>
			</div>
		</div>
	{/if}
</div>
