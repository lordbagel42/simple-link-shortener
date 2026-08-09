<script lang="ts">
	import { Download } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import CopyButton from './copy-button.svelte';

	let {
		open = $bindable(false),
		url,
		slug
	}: { open?: boolean; url: string; slug: string } = $props();

	let dataUrl = $state<string | null>(null);
	let svgMarkup = $state<string | null>(null);

	// `qrcode` is only pulled in when someone actually opens this dialog, so it
	// stays out of the dashboard's initial bundle.
	$effect(() => {
		if (!open) return;
		let cancelled = false;

		(async () => {
			const QRCode = await import('qrcode');
			const [png, svg] = await Promise.all([
				QRCode.toDataURL(url, { margin: 2, width: 512, errorCorrectionLevel: 'M' }),
				QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' })
			]);
			if (cancelled) return;
			dataUrl = png;
			svgMarkup = svg;
		})();

		return () => {
			cancelled = true;
		};
	});

	function download(kind: 'png' | 'svg') {
		const href =
			kind === 'png'
				? dataUrl!
				: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgMarkup!)}`;
		const anchor = document.createElement('a');
		anchor.href = href;
		anchor.download = `${slug}.${kind}`;
		anchor.click();
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-[360px]">
		<Dialog.Header>
			<Dialog.Title>QR code</Dialog.Title>
			<Dialog.Description class="font-mono text-xs break-all">{url}</Dialog.Description>
		</Dialog.Header>

		<div class="flex justify-center py-2">
			{#if dataUrl}
				<img src={dataUrl} alt="QR code for {url}" class="size-56 rounded-lg bg-white p-2" />
			{:else}
				<div class="bg-muted size-56 animate-pulse rounded-lg"></div>
			{/if}
		</div>

		<Dialog.Footer class="sm:justify-between">
			<CopyButton value={url} variant="outline" label="Copy short link" />
			<div class="flex gap-2">
				<Button variant="outline" size="sm" disabled={!svgMarkup} onclick={() => download('svg')}>
					<Download class="size-4" />
					SVG
				</Button>
				<Button size="sm" disabled={!dataUrl} onclick={() => download('png')}>
					<Download class="size-4" />
					PNG
				</Button>
			</div>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
