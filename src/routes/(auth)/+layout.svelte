<script lang="ts">
	import { Link2 } from '@lucide/svelte';

	let { children } = $props();
</script>

<div class="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
	<div class="w-full max-w-[380px]">
		<div class="mb-8 flex flex-col items-center gap-3">
			<div
				class="bg-foreground text-background flex size-9 items-center justify-center rounded-[10px]"
			>
				<Link2 class="size-[18px]" />
			</div>
		</div>
		{@render children()}
	</div>
</div>
