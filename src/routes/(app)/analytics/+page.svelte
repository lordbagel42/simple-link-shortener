<script lang="ts">
	import AnalyticsView from '$lib/components/app/analytics-view.svelte';

	let { data } = $props();
</script>

<svelte:head><title>Analytics · Links</title></svelte:head>

<div class="mb-6">
	<h1 class="text-lg font-semibold tracking-tight">Analytics</h1>
	<p class="text-muted-foreground mt-1 text-sm">Every click across all of your short links.</p>
</div>

<AnalyticsView analytics={data.analytics} recent={data.recent} range={data.range} />
