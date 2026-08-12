<script lang="ts">
	import { enhance } from '$app/forms';
	import { Download, Image as ImageIcon, Save, X } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { toast } from 'svelte-sonner';
	import { renderQrSvg, svgToPngDataUrl } from '$lib/qr';
	import { DEFAULT_QR_OPTIONS, type QrOptions, type SerializedLink } from '$lib/types';
	import CopyButton from './copy-button.svelte';

	let {
		open = $bindable(false),
		link,
		/** Present on pages that can persist the styling back to the link. */
		saveAction = null
	}: {
		open?: boolean;
		link: SerializedLink | null;
		saveAction?: string | null;
	} = $props();

	let options = $state<QrOptions>({ ...DEFAULT_QR_OPTIONS });
	let logoName = $state<string | null>(null);

	// The encoded URL carries `?qr=1`, which is what separates scans from
	// ordinary clicks in analytics.
	const target = $derived(link ? `${link.shortUrl}?qr=1` : '');

	$effect(() => {
		if (!open || !link) return;
		options = { ...DEFAULT_QR_OPTIONS, ...(link.qrOptions ?? {}) };
		logoName = options.logo ? 'Saved logo' : null;
	});

	const svg = $derived(target ? renderQrSvg(target, options) : '');
	const dataUrl = $derived(
		svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : ''
	);

	const styles = [
		{ value: 'square', label: 'Square' },
		{ value: 'rounded', label: 'Rounded' },
		{ value: 'dots', label: 'Dots' }
	];

	const corrections = [
		{ value: 'L', label: 'L — 7%' },
		{ value: 'M', label: 'M — 15%' },
		{ value: 'Q', label: 'Q — 25%' },
		{ value: 'H', label: 'H — 30%' }
	];

	async function download(kind: 'png' | 'svg') {
		const href =
			kind === 'svg' ? dataUrl : await svgToPngDataUrl(svg, options.size).catch(() => null);
		if (!href) {
			toast.error('Could not render the PNG.');
			return;
		}
		const anchor = document.createElement('a');
		anchor.href = href;
		anchor.download = `${link?.slug ?? 'qr'}.${kind}`;
		anchor.click();
	}

	/**
	 * Logos are inlined as data URLs so the SVG stays self-contained — a code
	 * that pulls its logo from a URL is a code that breaks when printed.
	 */
	async function pickLogo(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		if (file.size > 96 * 1024) {
			toast.error('Keep the logo under 96 KB — it is embedded in every export.');
			return;
		}

		const reader = new FileReader();
		reader.onload = () => {
			options = { ...options, logo: String(reader.result) };
			logoName = file.name;
			// A logo covers modules, so the code needs the headroom to survive it.
			if (options.errorCorrection === 'L' || options.errorCorrection === 'M') {
				options = { ...options, errorCorrection: 'H' };
			}
		};
		reader.readAsDataURL(file);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-[640px]">
		<Dialog.Header>
			<Dialog.Title>QR code</Dialog.Title>
			<Dialog.Description class="font-mono text-xs break-all">{target}</Dialog.Description>
		</Dialog.Header>

		<div class="grid gap-5 sm:grid-cols-[220px_1fr]">
			<div class="flex flex-col items-center gap-3">
				<div class="rounded-lg bg-white p-2">
					{#if dataUrl}
						<img src={dataUrl} alt="QR code for {target}" class="size-48" />
					{:else}
						<div class="bg-muted size-48 animate-pulse rounded"></div>
					{/if}
				</div>
				<div class="flex gap-2">
					<Button variant="outline" size="sm" onclick={() => download('svg')}>
						<Download class="size-4" />
						SVG
					</Button>
					<Button size="sm" onclick={() => download('png')}>
						<Download class="size-4" />
						PNG
					</Button>
				</div>
			</div>

			<div class="flex flex-col gap-3">
				<div class="grid grid-cols-2 gap-3">
					<div class="flex flex-col gap-1.5">
						<Label for="qr-fg" class="text-xs">Foreground</Label>
						<div class="flex items-center gap-2">
							<input
								id="qr-fg"
								type="color"
								class="border-border size-8 shrink-0 rounded border bg-transparent"
								bind:value={options.foreground}
							/>
							<Input bind:value={options.foreground} class="font-mono text-xs" />
						</div>
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="qr-bg" class="text-xs">Background</Label>
						<div class="flex items-center gap-2">
							<input
								id="qr-bg"
								type="color"
								class="border-border size-8 shrink-0 rounded border bg-transparent"
								value={options.background === 'transparent' ? '#ffffff' : options.background}
								oninput={(event) =>
									(options = { ...options, background: event.currentTarget.value })}
							/>
							<Input bind:value={options.background} class="font-mono text-xs" />
						</div>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div class="flex flex-col gap-1.5">
						<Label class="text-xs">Module style</Label>
						<Select.Root
							type="single"
							value={options.style}
							onValueChange={(value) =>
								value && (options = { ...options, style: value as QrOptions['style'] })}
						>
							<Select.Trigger>
								{styles.find((style) => style.value === options.style)?.label}
							</Select.Trigger>
							<Select.Content>
								{#each styles as style (style.value)}
									<Select.Item value={style.value}>{style.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>

					<div class="flex flex-col gap-1.5">
						<Label class="text-xs">Error correction</Label>
						<Select.Root
							type="single"
							value={options.errorCorrection}
							onValueChange={(value) =>
								value &&
								(options = {
									...options,
									errorCorrection: value as QrOptions['errorCorrection']
								})}
						>
							<Select.Trigger>
								{corrections.find((level) => level.value === options.errorCorrection)?.label}
							</Select.Trigger>
							<Select.Content>
								{#each corrections as level (level.value)}
									<Select.Item value={level.value}>{level.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div class="flex flex-col gap-1.5">
						<Label for="qr-margin" class="text-xs">Quiet zone</Label>
						<Input id="qr-margin" type="number" min="0" max="10" bind:value={options.margin} />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="qr-size" class="text-xs">PNG size (px)</Label>
						<Input id="qr-size" type="number" min="64" max="2048" step="64" bind:value={options.size} />
					</div>
				</div>

				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">Centre logo</Label>
					<div class="flex items-center gap-2">
						<label
							class="border-border hover:bg-muted flex h-9 flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 text-xs"
						>
							<ImageIcon class="size-4 shrink-0" />
							<span class="truncate">{logoName ?? 'Choose an image…'}</span>
							<input type="file" accept="image/*" class="hidden" onchange={pickLogo} />
						</label>
						{#if options.logo}
							<Button
								variant="ghost"
								size="icon"
								aria-label="Remove logo"
								onclick={() => {
									options = { ...options, logo: null };
									logoName = null;
								}}
							>
								<X class="size-4" />
							</Button>
						{/if}
					</div>
					{#if options.logo}
						<Input type="range" min="0.1" max="0.3" step="0.01" bind:value={options.logoScale} />
					{/if}
				</div>
			</div>
		</div>

		<Dialog.Footer class="sm:justify-between">
			<CopyButton value={link?.shortUrl ?? ''} variant="outline" label="Copy short link" />

			{#if saveAction && link}
				<form
					method="POST"
					action={saveAction}
					use:enhance={() => async ({ update }) => {
						toast.success('QR styling saved');
						await update({ reset: false });
					}}
				>
					<input type="hidden" name="id" value={link.id} />
					<input type="hidden" name="qrOptions" value={JSON.stringify(options)} />
					<Button type="submit" size="sm" variant="outline">
						<Save class="size-4" />
						Save styling
					</Button>
				</form>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
