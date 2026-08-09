<script lang="ts">
	import { page } from '$app/state';
	import { Link2 } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
</script>

<svelte:head><title>{page.status} · Links</title></svelte:head>

<div class="flex min-h-dvh flex-col items-center justify-center gap-5 px-6 text-center">
	<div class="bg-foreground text-background flex size-9 items-center justify-center rounded-[10px]">
		<Link2 class="size-[18px]" />
	</div>

	<div>
		<h1 class="text-lg font-semibold tracking-tight">
			{page.status === 404 ? 'Page not found' : 'Something went wrong'}
		</h1>
		<p class="text-muted-foreground mt-1.5 text-sm">
			{page.error?.message ?? 'An unexpected error occurred.'}
		</p>
	</div>

	<Button href="/" variant="outline" size="sm">Back to links</Button>
	<span class="text-muted-foreground/60 font-mono text-xs">{page.status}</span>
</div>
