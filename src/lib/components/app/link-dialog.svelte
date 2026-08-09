<script lang="ts">
	import { enhance } from '$app/forms';
	import { Plus, Trash2, Shuffle } from '@lucide/svelte';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Tabs from '$lib/components/ui/tabs';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Switch } from '$lib/components/ui/switch';
	import { toast } from 'svelte-sonner';
	import { generateSlug } from '$lib/slug';
	import { toDateTimeLocal } from '$lib/format';
	import type { LinkRule, SerializedLink } from '$lib/types';

	let {
		open = $bindable(false),
		link = null,
		shortBase
	}: {
		open?: boolean;
		link?: SerializedLink | null;
		shortBase: string;
	} = $props();

	const editing = $derived(Boolean(link));

	let slug = $state('');
	let destination = $state('');
	let title = $state('');
	let description = $state('');
	let tags = $state('');
	let enabled = $state(true);
	let forwardQuery = $state(false);
	let redirectStatus = $state('302');
	let password = $state('');
	let removePassword = $state(false);
	let expiresAt = $state('');
	let maxClicks = $state('');
	let fallbackUrl = $state('');
	let utmSource = $state('');
	let utmMedium = $state('');
	let utmCampaign = $state('');
	let utmTerm = $state('');
	let utmContent = $state('');
	let rules = $state<LinkRule[]>([]);
	let submitting = $state(false);
	let error = $state<string | null>(null);

	// Refill the form whenever the dialog is opened for a different link.
	$effect(() => {
		if (!open) return;
		slug = link?.slug ?? '';
		destination = link?.destination ?? '';
		title = link?.title ?? '';
		description = link?.description ?? '';
		tags = (link?.tags ?? []).join(', ');
		enabled = link?.enabled ?? true;
		forwardQuery = link?.forwardQuery ?? false;
		redirectStatus = String(link?.redirectStatus ?? 302);
		password = '';
		removePassword = false;
		expiresAt = toDateTimeLocal(link?.expiresAt ?? null);
		maxClicks = link?.maxClicks ? String(link.maxClicks) : '';
		fallbackUrl = link?.fallbackUrl ?? '';
		utmSource = link?.utmSource ?? '';
		utmMedium = link?.utmMedium ?? '';
		utmCampaign = link?.utmCampaign ?? '';
		utmTerm = link?.utmTerm ?? '';
		utmContent = link?.utmContent ?? '';
		rules = structuredClone($state.snapshot(link?.rules ?? []));
		error = null;
	});

	const ruleTypes: { value: LinkRule['type']; label: string; placeholder: string }[] = [
		{ value: 'country', label: 'Country is', placeholder: 'US' },
		{ value: 'continent', label: 'Continent is', placeholder: 'EU' },
		{ value: 'device', label: 'Device is', placeholder: 'mobile' },
		{ value: 'os', label: 'OS is', placeholder: 'iOS' },
		{ value: 'language', label: 'Language is', placeholder: 'de' },
		{ value: 'referer', label: 'Referrer contains', placeholder: 'twitter.com' }
	];

	const statuses = [
		{ value: '302', label: '302 — Temporary' },
		{ value: '307', label: '307 — Temporary, keeps method' },
		{ value: '301', label: '301 — Permanent' },
		{ value: '308', label: '308 — Permanent, keeps method' }
	];

	function addRule() {
		rules = [...rules, { type: 'country', value: '', destination: '' }];
	}

	function removeRule(index: number) {
		rules = rules.filter((_, i) => i !== index);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-[560px]">
		<Dialog.Header>
			<Dialog.Title>{editing ? 'Edit link' : 'Create link'}</Dialog.Title>
			<Dialog.Description>
				{editing
					? 'Changes reach the edge within about a minute.'
					: 'Point a short slug at any destination.'}
			</Dialog.Description>
		</Dialog.Header>

		<form
			method="POST"
			action={editing ? '?/update' : '?/create'}
			class="flex flex-col gap-4"
			use:enhance={() => {
				submitting = true;
				error = null;
				return async ({ result, update }) => {
					submitting = false;
					if (result.type === 'failure') {
						error = (result.data?.message as string) ?? 'Could not save the link.';
						return;
					}
					if (result.type === 'success') {
						toast.success(editing ? 'Link updated' : 'Link created');
						open = false;
					}
					await update({ reset: false });
				};
			}}
		>
			{#if editing}
				<input type="hidden" name="id" value={link!.id} />
			{/if}
			<input type="hidden" name="rules" value={JSON.stringify(rules)} />
			<input type="hidden" name="enabled" value={String(enabled)} />
			<input type="hidden" name="forwardQuery" value={String(forwardQuery)} />
			<input type="hidden" name="removePassword" value={String(removePassword)} />
			<input type="hidden" name="redirectStatus" value={redirectStatus} />

			<Tabs.Root value="general">
				<Tabs.List class="w-full">
					<Tabs.Trigger value="general" class="flex-1">General</Tabs.Trigger>
					<Tabs.Trigger value="rules" class="flex-1">
						Targeting{rules.length ? ` (${rules.length})` : ''}
					</Tabs.Trigger>
					<Tabs.Trigger value="advanced" class="flex-1">Advanced</Tabs.Trigger>
				</Tabs.List>

				<Tabs.Content value="general" class="mt-4 flex flex-col gap-4">
					<div class="flex flex-col gap-2">
						<Label for="destination">Destination URL</Label>
						<Input
							id="destination"
							name="destination"
							bind:value={destination}
							placeholder="https://example.com/somewhere/long"
							required
						/>
					</div>

					<div class="flex flex-col gap-2">
						<Label for="slug">Short link</Label>
						<div class="flex items-center gap-2">
							<span class="text-muted-foreground shrink-0 font-mono text-xs">
								{shortBase.replace(/^https?:\/\//, '')}/
							</span>
							<Input
								id="slug"
								name="slug"
								bind:value={slug}
								placeholder="auto-generated"
								class="font-mono"
								spellcheck="false"
							/>
							<Button
								type="button"
								variant="outline"
								size="icon"
								class="shrink-0"
								aria-label="Generate a random slug"
								onclick={() => (slug = generateSlug())}
							>
								<Shuffle class="size-4" />
							</Button>
						</div>
					</div>

					<div class="flex flex-col gap-2">
						<Label for="title">Title <span class="text-muted-foreground">(optional)</span></Label>
						<Input id="title" name="title" bind:value={title} placeholder="Launch announcement" />
					</div>

					<div class="flex flex-col gap-2">
						<Label for="tags">Tags <span class="text-muted-foreground">(comma separated)</span></Label>
						<Input id="tags" name="tags" bind:value={tags} placeholder="marketing, launch" />
					</div>

					<div
						class="border-border flex items-center justify-between rounded-lg border px-3 py-2.5"
					>
						<div>
							<p class="text-sm font-medium">Active</p>
							<p class="text-muted-foreground text-xs">Inactive links stop redirecting.</p>
						</div>
						<Switch bind:checked={enabled} />
					</div>
				</Tabs.Content>

				<Tabs.Content value="rules" class="mt-4 flex flex-col gap-3">
					<p class="text-muted-foreground text-xs">
						The first matching rule wins. Visitors that match nothing get the destination above.
					</p>

					{#each rules as rule, index (index)}
						<div class="border-border flex flex-col gap-2 rounded-lg border p-3">
							<div class="flex items-center gap-2">
								<Select.Root type="single" bind:value={rules[index].type}>
									<Select.Trigger class="w-[170px] shrink-0">
										{ruleTypes.find((t) => t.value === rule.type)?.label ?? 'Country is'}
									</Select.Trigger>
									<Select.Content>
										{#each ruleTypes as type (type.value)}
											<Select.Item value={type.value}>{type.label}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
								<Input
									bind:value={rules[index].value}
									placeholder={ruleTypes.find((t) => t.value === rule.type)?.placeholder}
								/>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									class="text-muted-foreground hover:text-destructive shrink-0"
									aria-label="Remove rule"
									onclick={() => removeRule(index)}
								>
									<Trash2 class="size-4" />
								</Button>
							</div>
							<Input bind:value={rules[index].destination} placeholder="https://example.com/de" />
						</div>
					{/each}

					<Button type="button" variant="outline" size="sm" class="self-start" onclick={addRule}>
						<Plus class="size-4" />
						Add rule
					</Button>
				</Tabs.Content>

				<Tabs.Content value="advanced" class="mt-4 flex flex-col gap-4">
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="flex flex-col gap-2">
							<Label for="expiresAt">Expires at</Label>
							<Input
								id="expiresAt"
								name="expiresAt"
								type="datetime-local"
								bind:value={expiresAt}
							/>
						</div>
						<div class="flex flex-col gap-2">
							<Label for="maxClicks">Click limit</Label>
							<Input
								id="maxClicks"
								name="maxClicks"
								type="number"
								min="1"
								bind:value={maxClicks}
								placeholder="Unlimited"
							/>
						</div>
					</div>

					<div class="flex flex-col gap-2">
						<Label for="fallbackUrl">Fallback URL</Label>
						<Input
							id="fallbackUrl"
							name="fallbackUrl"
							bind:value={fallbackUrl}
							placeholder="Where expired or disabled visitors go"
						/>
					</div>

					<div class="flex flex-col gap-2">
						<Label for="password">Password</Label>
						<Input
							id="password"
							name="password"
							type="password"
							autocomplete="new-password"
							bind:value={password}
							placeholder={link?.hasPassword ? 'Unchanged' : 'No password'}
							disabled={removePassword}
						/>
						{#if link?.hasPassword}
							<label class="text-muted-foreground flex items-center gap-2 text-xs">
								<input type="checkbox" bind:checked={removePassword} class="accent-foreground" />
								Remove the existing password
							</label>
						{/if}
					</div>

					<div class="flex flex-col gap-2">
						<Label>Redirect status</Label>
						<Select.Root type="single" bind:value={redirectStatus}>
							<Select.Trigger>
								{statuses.find((s) => s.value === redirectStatus)?.label}
							</Select.Trigger>
							<Select.Content>
								{#each statuses as status (status.value)}
									<Select.Item value={status.value}>{status.label}</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<p class="text-muted-foreground text-xs">
							Permanent redirects are cached by browsers, which hides repeat clicks from analytics.
						</p>
					</div>

					<div
						class="border-border flex items-center justify-between rounded-lg border px-3 py-2.5"
					>
						<div>
							<p class="text-sm font-medium">Forward query string</p>
							<p class="text-muted-foreground text-xs">
								Pass <code class="font-mono">?ref=…</code> through to the destination.
							</p>
						</div>
						<Switch bind:checked={forwardQuery} />
					</div>

					<div class="flex flex-col gap-2">
						<Label>UTM parameters</Label>
						<div class="grid gap-2 sm:grid-cols-2">
							<Input name="utmSource" bind:value={utmSource} placeholder="utm_source" />
							<Input name="utmMedium" bind:value={utmMedium} placeholder="utm_medium" />
							<Input name="utmCampaign" bind:value={utmCampaign} placeholder="utm_campaign" />
							<Input name="utmTerm" bind:value={utmTerm} placeholder="utm_term" />
						</div>
						<Input name="utmContent" bind:value={utmContent} placeholder="utm_content" />
					</div>

					<div class="flex flex-col gap-2">
						<Label for="description">Notes</Label>
						<Textarea
							id="description"
							name="description"
							bind:value={description}
							rows={2}
							placeholder="Only visible to you."
						/>
					</div>
				</Tabs.Content>
			</Tabs.Root>

			{#if error}
				<p class="text-destructive text-sm">{error}</p>
			{/if}

			<Dialog.Footer class="mt-2">
				<Button type="button" variant="ghost" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={submitting}>
					{submitting ? 'Saving…' : editing ? 'Save changes' : 'Create link'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
