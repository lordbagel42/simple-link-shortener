<script lang="ts">
	import { formatBucket, formatCount, formatNumber } from '$lib/format';
	import type { TimePoint } from '$lib/types';

	let { points, height = 220 }: { points: TimePoint[]; height?: number } = $props();

	// Fixed viewBox with `preserveAspectRatio="none"` — the SVG stretches to the
	// container while strokes stay crisp via `vector-effect`.
	const W = 1000;
	const H = 300;
	const PAD = 8;

	const max = $derived(Math.max(1, ...points.map((p) => p.clicks)));
	const step = $derived(points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0);

	function x(index: number): number {
		return PAD + index * step;
	}

	function y(value: number): number {
		return H - PAD - (value / max) * (H - PAD * 2);
	}

	const linePath = $derived(
		points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index)},${y(point.clicks)}`).join(' ')
	);

	const areaPath = $derived(
		points.length === 0 ? '' : `${linePath} L${x(points.length - 1)},${H} L${x(0)},${H} Z`
	);

	let hovered = $state<number | null>(null);
	let container = $state<HTMLDivElement | null>(null);

	function onmove(event: PointerEvent) {
		if (!container || points.length === 0) return;
		const rect = container.getBoundingClientRect();
		const ratio = (event.clientX - rect.left) / rect.width;
		hovered = Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
	}

	const active = $derived(hovered === null ? null : points[hovered]);
	const hasData = $derived(points.some((point) => point.clicks > 0));
</script>

<div
	bind:this={container}
	class="relative w-full"
	style="height: {height}px"
	onpointermove={onmove}
	onpointerleave={() => (hovered = null)}
	role="img"
	aria-label="Clicks over time"
>
	<svg
		viewBox="0 0 {W} {H}"
		preserveAspectRatio="none"
		class="text-foreground h-full w-full overflow-visible"
	>
		<defs>
			<linearGradient id="clicks-fill" x1="0" y1="0" x2="0" y2="1">
				<stop offset="0%" stop-color="currentColor" stop-opacity="0.18" />
				<stop offset="100%" stop-color="currentColor" stop-opacity="0" />
			</linearGradient>
		</defs>

		{#each [0.25, 0.5, 0.75] as fraction (fraction)}
			<line
				x1="0"
				x2={W}
				y1={PAD + (H - PAD * 2) * fraction}
				y2={PAD + (H - PAD * 2) * fraction}
				class="stroke-border"
				stroke-dasharray="4 6"
				vector-effect="non-scaling-stroke"
				stroke-width="1"
			/>
		{/each}

		{#if points.length > 1}
			<path d={areaPath} fill="url(#clicks-fill)" />
			<path
				d={linePath}
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				vector-effect="non-scaling-stroke"
				stroke-linejoin="round"
				stroke-linecap="round"
			/>
		{/if}

		{#if hovered !== null && active}
			<line
				x1={x(hovered)}
				x2={x(hovered)}
				y1="0"
				y2={H}
				class="stroke-border"
				vector-effect="non-scaling-stroke"
				stroke-width="1"
			/>
			<circle cx={x(hovered)} cy={y(active.clicks)} r="3" fill="currentColor" />
		{/if}
	</svg>

	{#if !hasData}
		<div class="text-muted-foreground absolute inset-0 grid place-items-center text-sm">
			No clicks in this period
		</div>
	{/if}

	{#if active}
		<div
			class="border-border bg-popover text-popover-foreground pointer-events-none absolute top-2 rounded-lg border px-3 py-2 text-xs shadow-md"
			style="left: clamp(0px, {(hovered! / Math.max(1, points.length - 1)) *
				100}% - 60px, calc(100% - 130px))"
		>
			<p class="font-medium">{formatBucket(active.bucket)}</p>
			<p class="text-muted-foreground mt-0.5 tabular-nums">
				{formatNumber(active.clicks)} clicks · {formatNumber(active.uniques)} unique
			</p>
		</div>
	{/if}
</div>

{#if points.length > 1}
	<div class="text-muted-foreground mt-2 flex justify-between text-[11px]">
		<span>{formatBucket(points[0].bucket)}</span>
		<span class="tabular-nums">peak {formatCount(max)}</span>
		<span>{formatBucket(points[points.length - 1].bucket)}</span>
	</div>
{/if}
