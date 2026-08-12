<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ArrowDown, ArrowUp, Minus } from '@lucide/svelte';
	import { formatCount } from '$lib/format';

	let {
		label,
		value,
		hint,
		icon,
		previous,
		/** Set when a rise is bad — bot traffic, error rates. */
		inverted = false
	}: {
		label: string;
		value: number | string;
		hint?: string;
		icon?: Snippet;
		previous?: number | null;
		inverted?: boolean;
	} = $props();

	/**
	 * Percentage change against the preceding window of equal length. Growth
	 * from zero has no meaningful percentage, so it is shown as "new".
	 */
	const delta = $derived.by(() => {
		if (previous === undefined || previous === null || typeof value !== 'number') return null;
		if (previous === 0) return value === 0 ? { kind: 'flat' as const } : { kind: 'new' as const };
		const change = ((value - previous) / previous) * 100;
		if (Math.abs(change) < 0.5) return { kind: 'flat' as const };
		return { kind: 'change' as const, change };
	});

	const good = $derived(
		delta?.kind === 'change' ? (delta.change > 0) !== inverted : !inverted
	);
</script>

<div class="border-border bg-card rounded-xl border p-4">
	<div class="text-muted-foreground flex items-center gap-2 text-xs font-medium">
		{#if icon}{@render icon()}{/if}
		{label}
	</div>

	<div class="mt-2 flex items-baseline gap-2">
		<p class="text-2xl font-semibold tracking-tight tabular-nums">
			{typeof value === 'number' ? formatCount(value) : value}
		</p>

		{#if delta}
			<span
				class="flex items-center gap-0.5 text-xs font-medium tabular-nums
					{delta.kind === 'flat'
					? 'text-muted-foreground'
					: good
						? 'text-emerald-600 dark:text-emerald-400'
						: 'text-red-600 dark:text-red-400'}"
				title="Compared with the previous period"
			>
				{#if delta.kind === 'flat'}
					<Minus class="size-3" />
				{:else if delta.kind === 'new'}
					new
				{:else if delta.change > 0}
					<ArrowUp class="size-3" />{Math.round(delta.change)}%
				{:else}
					<ArrowDown class="size-3" />{Math.round(Math.abs(delta.change))}%
				{/if}
			</span>
		{/if}
	</div>

	{#if hint}
		<p class="text-muted-foreground mt-1 text-xs">{hint}</p>
	{/if}
</div>
