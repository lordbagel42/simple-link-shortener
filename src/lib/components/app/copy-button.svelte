<script lang="ts">
	import { Check, Copy } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { toast } from 'svelte-sonner';

	let {
		value,
		label = 'Copy',
		variant = 'ghost',
		class: className = ''
	}: {
		value: string;
		label?: string;
		variant?: 'ghost' | 'outline' | 'secondary';
		class?: string;
	} = $props();

	let copied = $state(false);
	let timer: ReturnType<typeof setTimeout>;

	async function copy() {
		try {
			await navigator.clipboard.writeText(value);
			copied = true;
			clearTimeout(timer);
			timer = setTimeout(() => (copied = false), 1500);
		} catch {
			toast.error('Clipboard access was blocked.');
		}
	}
</script>

<Button
	{variant}
	size="icon"
	class="text-muted-foreground hover:text-foreground size-7 {className}"
	aria-label={label}
	title={label}
	onclick={copy}
>
	{#if copied}
		<Check class="size-3.5" />
	{:else}
		<Copy class="size-3.5" />
	{/if}
</Button>
