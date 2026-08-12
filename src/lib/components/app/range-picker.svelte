<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { CalendarRange, Check } from '@lucide/svelte';
	import * as Popover from '$lib/components/ui/popover';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { RANGES, type AnalyticsWindow, type Interval } from '$lib/types';

	let {
		window: current,
		bots = 'all'
	}: { window: AnalyticsWindow; bots?: 'all' | 'exclude' | 'only' } = $props();

	const presets = Object.entries(RANGES).map(([value, config]) => ({
		value,
		label: config.label
	}));

	const intervals: { value: Interval; label: string }[] = [
		{ value: 'hour', label: 'Hourly' },
		{ value: 'day', label: 'Daily' },
		{ value: 'week', label: 'Weekly' },
		{ value: 'month', label: 'Monthly' }
	];

	const botOptions = [
		{ value: 'all', label: 'All traffic' },
		{ value: 'exclude', label: 'Humans only' },
		{ value: 'only', label: 'Bots only' }
	];

	let customOpen = $state(false);
	// Seeded once from the resolved window; the two date inputs own them after
	// that, so typing a range is not undone by the page reloading behind it.
	// svelte-ignore state_referenced_locally
	let from = $state(toDateInput(current.from ?? Date.now() - 7 * 86_400_000));
	// svelte-ignore state_referenced_locally
	let to = $state(toDateInput(current.to));

	function toDateInput(at: number): string {
		return new Date(at).toISOString().slice(0, 10);
	}

	/**
	 * All of this lives in the query string rather than component state, so a
	 * view is a URL: shareable, bookmarkable, and reloadable.
	 */
	function apply(changes: Record<string, string | null>) {
		const url = new URL(page.url);
		for (const [key, value] of Object.entries(changes)) {
			if (value === null) url.searchParams.delete(key);
			else url.searchParams.set(key, value);
		}
		goto(`${url.pathname}${url.search}`, { noScroll: true, keepFocus: true });
	}

	function applyPreset(value: string | undefined) {
		if (!value) return;
		// A preset and an explicit from/to cannot both be in effect.
		apply({ range: value, from: null, to: null, interval: null });
	}

	function applyCustom() {
		if (!from || !to) return;
		customOpen = false;
		apply({
			from: `${from}T00:00:00Z`,
			// Inclusive of the end day, which is what picking it implies.
			to: `${to}T23:59:59Z`,
			range: null
		});
	}
</script>

<div class="flex flex-wrap items-center gap-2">
	<Select.Root
		type="single"
		value={current.range === 'custom' ? undefined : current.range}
		onValueChange={applyPreset}
	>
		<Select.Trigger class="w-[168px]">{current.label}</Select.Trigger>
		<Select.Content>
			{#each presets as preset (preset.value)}
				<Select.Item value={preset.value}>{preset.label}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	<Popover.Root bind:open={customOpen}>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button
					{...props}
					variant={current.range === 'custom' ? 'default' : 'outline'}
					size="icon"
					aria-label="Custom date range"
				>
					<CalendarRange class="size-4" />
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content class="w-[280px]" align="end">
			<div class="flex flex-col gap-3">
				<div class="flex flex-col gap-1.5">
					<Label for="range-from" class="text-xs">From</Label>
					<Input id="range-from" type="date" bind:value={from} max={to} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="range-to" class="text-xs">To</Label>
					<Input id="range-to" type="date" bind:value={to} min={from} />
				</div>
				<Button size="sm" onclick={applyCustom} disabled={!from || !to || from > to}>
					<Check class="size-4" />
					Apply range
				</Button>
			</div>
		</Popover.Content>
	</Popover.Root>

	<Select.Root
		type="single"
		value={current.interval}
		onValueChange={(value) => value && apply({ interval: value })}
	>
		<Select.Trigger class="w-[112px]">
			{intervals.find((option) => option.value === current.interval)?.label ?? 'Daily'}
		</Select.Trigger>
		<Select.Content>
			{#each intervals as interval (interval.value)}
				<Select.Item value={interval.value}>{interval.label}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>

	<Select.Root
		type="single"
		value={bots}
		onValueChange={(value) => value && apply({ bots: value === 'all' ? null : value })}
	>
		<Select.Trigger class="w-[132px]">
			{botOptions.find((option) => option.value === bots)?.label ?? 'All traffic'}
		</Select.Trigger>
		<Select.Content>
			{#each botOptions as option (option.value)}
				<Select.Item value={option.value}>{option.label}</Select.Item>
			{/each}
		</Select.Content>
	</Select.Root>
</div>
