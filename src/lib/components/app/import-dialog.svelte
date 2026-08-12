<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { Upload } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { toast } from 'svelte-sonner';
	import type { SerializedDomain } from '$lib/types';

	let {
		open = $bindable(false),
		domains
	}: { open?: boolean; domains: SerializedDomain[] } = $props();

	let csv = $state('');
	let domainId = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);

	const SAMPLE = 'destination,slug,title,tags\nhttps://example.com/launch,launch,Launch post,marketing';

	$effect(() => {
		if (!open) return;
		domainId = domains.find((domain) => domain.isDefault)?.id ?? domains[0]?.id ?? '';
		error = null;
	});

	async function readFile(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		csv = await file.text();
	}

	/**
	 * Posted straight to the public API rather than a form action — it is the
	 * same endpoint scripts use, so anything that imports here imports there.
	 */
	async function submit() {
		if (!csv.trim()) return;
		busy = true;
		error = null;

		try {
			const response = await fetch(
				`/api/v1/links/import${domainId ? `?domain=${encodeURIComponent(domainId)}` : ''}`,
				{ method: 'POST', headers: { 'content-type': 'text/csv' }, body: csv }
			);
			const result = (await response.json()) as {
				imported?: number;
				skipped?: number;
				message?: string;
			};

			if (!response.ok) {
				error = result.message ?? 'Import failed.';
				return;
			}

			toast.success(
				`Imported ${result.imported} ${result.imported === 1 ? 'link' : 'links'}` +
					(result.skipped ? `, skipped ${result.skipped}` : '')
			);
			csv = '';
			open = false;
			await invalidateAll();
		} catch {
			error = 'Could not reach the server.';
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-[560px]">
		<Dialog.Header>
			<Dialog.Title>Import links</Dialog.Title>
			<Dialog.Description>
				Paste CSV with a header row, or pick a file. Column names are matched loosely, so an export
				from another shortener usually works unedited.
			</Dialog.Description>
		</Dialog.Header>

		<div class="flex flex-col gap-4">
			{#if domains.length > 1}
				<div class="flex flex-col gap-2">
					<Label>Import into</Label>
					<Select.Root type="single" bind:value={domainId}>
						<Select.Trigger class="font-mono text-xs">
							{domains.find((domain) => domain.id === domainId)?.hostname ?? 'Domain'}
						</Select.Trigger>
						<Select.Content>
							{#each domains as domain (domain.id)}
								<Select.Item value={domain.id}>{domain.hostname}{domain.prefix}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}

			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<Label for="import-csv">CSV</Label>
					<label class="text-muted-foreground hover:text-foreground cursor-pointer text-xs">
						Choose a file…
						<input type="file" accept=".csv,text/csv" class="hidden" onchange={readFile} />
					</label>
				</div>
				<Textarea
					id="import-csv"
					bind:value={csv}
					rows={8}
					class="font-mono text-xs"
					placeholder={SAMPLE}
					spellcheck="false"
				/>
				<p class="text-muted-foreground text-xs">
					Recognised columns: destination (or long_url, original_url), slug (or path, keyword),
					title, description, tags, expires_at, max_clicks, fallback_url, redirect_status, and the
					five utm_* fields. Rows without a destination are skipped.
				</p>
			</div>

			{#if error}
				<p class="text-destructive text-sm">{error}</p>
			{/if}
		</div>

		<Dialog.Footer>
			<Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
			<Button onclick={submit} disabled={busy || !csv.trim()}>
				<Upload class="size-4" />
				{busy ? 'Importing…' : 'Import'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
