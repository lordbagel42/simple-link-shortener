<script lang="ts">
	import { Bot, QrCode } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { countryFlag, formatDateTime, prettyUrl, timeAgo } from '$lib/format';
	import type { RecentClick } from '$lib/types';

	let { clicks, showSlug = true }: { clicks: RecentClick[]; showSlug?: boolean } = $props();

	function place(click: RecentClick): string {
		return [click.city, click.region, click.country].filter(Boolean).join(', ') || 'Unknown';
	}

	/** Everything the edge decided about this one request, on one line. */
	function decision(click: RecentClick): string {
		return [
			click.variant ? `arm ${click.variant}` : null,
			click.ruleMatched,
			click.responseStatus ? String(click.responseStatus) : null,
			click.processingMs === null ? null : `${click.processingMs}ms`
		]
			.filter(Boolean)
			.join(' · ');
	}
</script>

<div class="border-border bg-card overflow-hidden rounded-xl border">
	<div class="border-border flex items-center justify-between border-b px-4 py-3">
		<h3 class="text-sm font-medium">Recent clicks</h3>
		<span class="text-muted-foreground text-xs">Newest first</span>
	</div>

	{#if clicks.length === 0}
		<p class="text-muted-foreground px-4 py-10 text-center text-sm">No clicks recorded yet.</p>
	{:else}
		<div class="divide-border divide-y">
			{#each clicks as click (click.id)}
				<div class="flex items-center gap-3 px-4 py-2.5 text-sm">
					<span class="shrink-0 text-base" aria-hidden="true">{countryFlag(click.country)}</span>

					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
							{#if showSlug}
								<a href="/links/{click.linkId}" class="font-mono text-xs hover:underline">
									/{click.slug ?? '—'}
								</a>
							{/if}
							<span class="truncate">{place(click)}</span>
							{#if click.isNewVisitor}
								<Badge variant="outline" class="h-4 px-1.5 text-[10px] font-normal">new</Badge>
							{/if}
							{#if click.isQr}
								<QrCode class="text-muted-foreground size-3.5" aria-label="QR scan" />
							{/if}
							{#if click.isBot}
								<Bot class="text-muted-foreground size-3.5" aria-label="Bot" />
							{/if}
						</div>
						<p class="text-muted-foreground truncate text-xs">
							{[click.browser, click.os, click.deviceType].filter(Boolean).join(' · ')}
							{click.refererDomain ? ` · from ${click.refererDomain}` : ''}
							{click.colo ? ` · ${click.colo}` : ''}
						</p>
					</div>

					<div class="hidden shrink-0 text-right sm:block">
						<p
							class="text-muted-foreground font-mono text-xs"
							title={click.userAgent ?? 'No user agent sent'}
						>
							{click.ip ?? '—'}
						</p>
						<p class="text-muted-foreground/70 text-[11px]" title={formatDateTime(click.timestamp)}>
							{timeAgo(click.timestamp)} · {prettyUrl(click.destination, 24)}
						</p>
					</div>

					<div class="text-muted-foreground/70 hidden w-40 shrink-0 truncate text-right text-[11px] lg:block">
						{decision(click)}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
