<script lang="ts">
	import type { Snippet } from 'svelte';
	import { formatCount } from '$lib/format';

	let {
		label,
		value,
		hint,
		icon
	}: { label: string; value: number | string; hint?: string; icon?: Snippet } = $props();
</script>

<div class="border-border bg-card rounded-xl border p-4">
	<div class="text-muted-foreground flex items-center gap-2 text-xs font-medium">
		{#if icon}{@render icon()}{/if}
		{label}
	</div>
	<p class="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
		{typeof value === 'number' ? formatCount(value) : value}
	</p>
	{#if hint}
		<p class="text-muted-foreground mt-1 text-xs">{hint}</p>
	{/if}
</div>
