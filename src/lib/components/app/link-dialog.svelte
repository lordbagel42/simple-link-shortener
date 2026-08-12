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
	import type {
		CloakConfig,
		DeepLinkConfig,
		LinkRule,
		LinkVariant,
		RuleOperator,
		SerializedDomain,
		SerializedFolder,
		SerializedLink
	} from '$lib/types';

	let {
		open = $bindable(false),
		link = null,
		domains,
		folders
	}: {
		open?: boolean;
		link?: SerializedLink | null;
		domains: SerializedDomain[];
		folders: SerializedFolder[];
	} = $props();

	const editing = $derived(Boolean(link));

	let slug = $state('');
	let destination = $state('');
	let domainId = $state('');
	let folderId = $state('');
	let title = $state('');
	let description = $state('');
	let tags = $state('');
	let enabled = $state(true);
	let forwardQuery = $state(false);
	let hideReferrer = $state(false);
	let trackConversions = $state(false);
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
	let variants = $state<LinkVariant[]>([]);
	let cloak = $state<CloakConfig>({ enabled: false, title: '', description: '', image: '' });
	let deepLink = $state<DeepLinkConfig>({
		iosUrl: '',
		iosFallback: '',
		androidUrl: '',
		androidFallback: '',
		timeoutMs: 1200
	});
	let submitting = $state(false);
	let error = $state<string | null>(null);

	const defaultDomain = $derived(domains.find((domain) => domain.isDefault) ?? domains[0]);
	const activeDomain = $derived(
		domains.find((domain) => domain.id === domainId) ?? defaultDomain
	);
	const shortPrefix = $derived(
		activeDomain ? `${activeDomain.hostname}${activeDomain.prefix}/` : ''
	);

	// Refill the form whenever the dialog is opened for a different link.
	$effect(() => {
		if (!open) return;
		slug = link?.slug ?? '';
		destination = link?.destination ?? '';
		domainId = link?.domainId ?? defaultDomain?.id ?? '';
		folderId = link?.folderId ?? '';
		title = link?.title ?? '';
		description = link?.description ?? '';
		tags = (link?.tags ?? []).join(', ');
		enabled = link?.enabled ?? true;
		forwardQuery = link?.forwardQuery ?? false;
		hideReferrer = link?.hideReferrer ?? false;
		trackConversions = link?.trackConversions ?? false;
		redirectStatus = String(link?.redirectStatus ?? activeDomain?.redirectStatus ?? 302);
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
		variants = structuredClone($state.snapshot(link?.variants ?? []));
		cloak = {
			enabled: link?.cloak?.enabled ?? false,
			title: link?.cloak?.title ?? '',
			description: link?.cloak?.description ?? '',
			image: link?.cloak?.image ?? ''
		};
		deepLink = {
			iosUrl: link?.deepLink?.iosUrl ?? '',
			iosFallback: link?.deepLink?.iosFallback ?? '',
			androidUrl: link?.deepLink?.androidUrl ?? '',
			androidFallback: link?.deepLink?.androidFallback ?? '',
			timeoutMs: link?.deepLink?.timeoutMs ?? 1200
		};
		error = null;
	});

	const ruleTypes: { value: LinkRule['type']; label: string; placeholder: string }[] = [
		{ value: 'country', label: 'Country', placeholder: 'US, CA' },
		{ value: 'region', label: 'Region', placeholder: 'California' },
		{ value: 'city', label: 'City', placeholder: 'Berlin' },
		{ value: 'continent', label: 'Continent', placeholder: 'EU' },
		{ value: 'device', label: 'Device', placeholder: 'mobile' },
		{ value: 'os', label: 'OS', placeholder: 'iOS' },
		{ value: 'browser', label: 'Browser', placeholder: 'Safari' },
		{ value: 'language', label: 'Language', placeholder: 'de' },
		{ value: 'referer', label: 'Referrer', placeholder: 'twitter.com' },
		{ value: 'asn', label: 'ASN', placeholder: '13335' },
		{ value: 'timezone', label: 'Time zone', placeholder: 'Europe/Berlin' },
		{ value: 'query', label: 'Query string', placeholder: 'campaign=spring' }
	];

	const operators: { value: RuleOperator; label: string }[] = [
		{ value: 'is', label: 'is' },
		{ value: 'contains', label: 'contains' },
		{ value: 'starts_with', label: 'starts with' },
		{ value: 'ends_with', label: 'ends with' },
		{ value: 'not', label: 'is not' }
	];

	const statuses = [
		{ value: '302', label: '302 — Temporary' },
		{ value: '307', label: '307 — Temporary, keeps method' },
		{ value: '301', label: '301 — Permanent' },
		{ value: '308', label: '308 — Permanent, keeps method' }
	];

	function addRule() {
		rules = [...rules, { type: 'country', op: 'is', value: '', destination: '' }];
	}

	function removeRule(index: number) {
		rules = rules.filter((_, i) => i !== index);
	}

	function addVariant() {
		// A split test needs at least two arms, so the first click seeds both.
		const seed = variants.length === 0 ? [{ label: 'A', destination, weight: 50 }] : [];
		variants = [
			...variants,
			...seed,
			{ label: String.fromCharCode(65 + variants.length + seed.length), destination: '', weight: 50 }
		];
	}

	function removeVariant(index: number) {
		variants = variants.filter((_, i) => i !== index);
	}

	const totalWeight = $derived(variants.reduce((sum, variant) => sum + (variant.weight || 0), 0));

	function share(weight: number): string {
		return totalWeight > 0 ? `${Math.round((weight / totalWeight) * 100)}%` : '—';
	}

	/** `null` for the empty configs, so the server stores nothing rather than a husk. */
	const cloakPayload = $derived(
		cloak.enabled || cloak.title || cloak.description || cloak.image ? cloak : null
	);
	const deepLinkPayload = $derived(deepLink.iosUrl || deepLink.androidUrl ? deepLink : null);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90dvh] overflow-y-auto sm:max-w-[620px]">
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
			<input type="hidden" name="domainId" value={domainId} />
			<input type="hidden" name="folderId" value={folderId} />
			<input type="hidden" name="rules" value={JSON.stringify(rules)} />
			<input type="hidden" name="variants" value={JSON.stringify(variants)} />
			<input type="hidden" name="cloak" value={JSON.stringify(cloakPayload)} />
			<input type="hidden" name="deepLink" value={JSON.stringify(deepLinkPayload)} />
			<input type="hidden" name="enabled" value={String(enabled)} />
			<input type="hidden" name="forwardQuery" value={String(forwardQuery)} />
			<input type="hidden" name="hideReferrer" value={String(hideReferrer)} />
			<input type="hidden" name="trackConversions" value={String(trackConversions)} />
			<input type="hidden" name="removePassword" value={String(removePassword)} />
			<input type="hidden" name="redirectStatus" value={redirectStatus} />

			<Tabs.Root value="general">
				<Tabs.List class="w-full flex-wrap">
					<Tabs.Trigger value="general" class="flex-1">General</Tabs.Trigger>
					<Tabs.Trigger value="rules" class="flex-1">
						Targeting{rules.length ? ` (${rules.length})` : ''}
					</Tabs.Trigger>
					<Tabs.Trigger value="split" class="flex-1">
						Split{variants.length ? ` (${variants.length})` : ''}
					</Tabs.Trigger>
					<Tabs.Trigger value="behaviour" class="flex-1">Behaviour</Tabs.Trigger>
					<Tabs.Trigger value="advanced" class="flex-1">Advanced</Tabs.Trigger>
				</Tabs.List>

				<!-- General ------------------------------------------------------- -->
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
							{#if domains.length > 1}
								<Select.Root type="single" bind:value={domainId}>
									<Select.Trigger class="w-[180px] shrink-0 font-mono text-xs">
										{activeDomain?.hostname ?? 'Domain'}
									</Select.Trigger>
									<Select.Content>
										{#each domains as domain (domain.id)}
											<Select.Item value={domain.id}>
												{domain.hostname}{domain.prefix}
											</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							{:else}
								<span class="text-muted-foreground shrink-0 font-mono text-xs">{shortPrefix}</span>
							{/if}
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
								onclick={() => (slug = generateSlug(activeDomain?.slugLength ?? 6))}
							>
								<Shuffle class="size-4" />
							</Button>
						</div>
						{#if domains.length > 1 && activeDomain}
							<p class="text-muted-foreground font-mono text-xs">
								{shortPrefix}{slug || '…'}
							</p>
						{/if}
					</div>

					<div class="grid gap-4 sm:grid-cols-2">
						<div class="flex flex-col gap-2">
							<Label for="title">Title <span class="text-muted-foreground">(optional)</span></Label>
							<Input id="title" name="title" bind:value={title} placeholder="Launch announcement" />
						</div>
						<div class="flex flex-col gap-2">
							<Label>Folder</Label>
							<Select.Root type="single" bind:value={folderId}>
								<Select.Trigger>
									{folders.find((folder) => folder.id === folderId)?.name ?? 'No folder'}
								</Select.Trigger>
								<Select.Content>
									<Select.Item value="">No folder</Select.Item>
									{#each folders as folder (folder.id)}
										<Select.Item value={folder.id}>{folder.name}</Select.Item>
									{/each}
								</Select.Content>
							</Select.Root>
						</div>
					</div>

					<div class="flex flex-col gap-2">
						<Label for="tags">Tags <span class="text-muted-foreground">(comma separated)</span></Label>
						<Input id="tags" name="tags" bind:value={tags} placeholder="marketing, launch" />
					</div>

					<div class="border-border flex items-center justify-between rounded-lg border px-3 py-2.5">
						<div>
							<p class="text-sm font-medium">Active</p>
							<p class="text-muted-foreground text-xs">Inactive links stop redirecting.</p>
						</div>
						<Switch bind:checked={enabled} />
					</div>
				</Tabs.Content>

				<!-- Targeting ----------------------------------------------------- -->
				<Tabs.Content value="rules" class="mt-4 flex flex-col gap-3">
					<p class="text-muted-foreground text-xs">
						The first matching rule wins, and it takes priority over any split test. Separate
						alternatives with commas — <code class="font-mono">US, CA, MX</code>.
					</p>

					{#each rules as rule, index (index)}
						<div class="border-border flex flex-col gap-2 rounded-lg border p-3">
							<div class="flex items-center gap-2">
								<Select.Root type="single" bind:value={rules[index].type}>
									<Select.Trigger class="w-[130px] shrink-0">
										{ruleTypes.find((type) => type.value === rule.type)?.label ?? 'Country'}
									</Select.Trigger>
									<Select.Content>
										{#each ruleTypes as type (type.value)}
											<Select.Item value={type.value}>{type.label}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>

								<Select.Root
									type="single"
									value={rules[index].op ?? 'contains'}
									onValueChange={(value) =>
										value && (rules[index].op = value as RuleOperator)}
								>
									<Select.Trigger class="w-[120px] shrink-0">
										{operators.find((op) => op.value === (rule.op ?? 'contains'))?.label}
									</Select.Trigger>
									<Select.Content>
										{#each operators as operator (operator.value)}
											<Select.Item value={operator.value}>{operator.label}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>

								<Input
									bind:value={rules[index].value}
									placeholder={ruleTypes.find((type) => type.value === rule.type)?.placeholder}
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

				<!-- Split test ---------------------------------------------------- -->
				<Tabs.Content value="split" class="mt-4 flex flex-col gap-3">
					<p class="text-muted-foreground text-xs">
						Traffic is divided by weight, and each visitor is pinned to their arm with a cookie so
						repeat clicks stay consistent. Fewer than two arms turns the test off.
					</p>

					{#each variants as variant, index (index)}
						<div class="border-border flex flex-col gap-2 rounded-lg border p-3">
							<div class="flex items-center gap-2">
								<Input
									bind:value={variants[index].label}
									placeholder="Label"
									class="w-[90px] shrink-0"
								/>
								<Input
									bind:value={variants[index].destination}
									placeholder="https://example.com/variant"
								/>
								<Input
									type="number"
									min="0"
									bind:value={variants[index].weight}
									class="w-[80px] shrink-0"
								/>
								<span class="text-muted-foreground w-10 shrink-0 text-right text-xs tabular-nums">
									{share(variant.weight)}
								</span>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									class="text-muted-foreground hover:text-destructive shrink-0"
									aria-label="Remove arm"
									onclick={() => removeVariant(index)}
								>
									<Trash2 class="size-4" />
								</Button>
							</div>
						</div>
					{/each}

					<Button type="button" variant="outline" size="sm" class="self-start" onclick={addVariant}>
						<Plus class="size-4" />
						Add arm
					</Button>
				</Tabs.Content>

				<!-- Behaviour ----------------------------------------------------- -->
				<Tabs.Content value="behaviour" class="mt-4 flex flex-col gap-4">
					<div class="border-border flex flex-col gap-3 rounded-lg border p-3">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-sm font-medium">Cloak the destination</p>
								<p class="text-muted-foreground text-xs">
									Frame the page so the short URL stays in the address bar.
								</p>
							</div>
							<Switch bind:checked={cloak.enabled} />
						</div>
						{#if cloak.enabled}
							<Input bind:value={cloak.title} placeholder="Page title" />
							<Input bind:value={cloak.description} placeholder="Description, for link previews" />
							<Input bind:value={cloak.image} placeholder="https://example.com/preview.png" />
							<p class="text-muted-foreground text-xs">
								Sites that send <code class="font-mono">X-Frame-Options</code> cannot be framed;
								those visitors get an "open directly" link instead.
							</p>
						{/if}
					</div>

					<div class="border-border flex items-center justify-between rounded-lg border px-3 py-2.5">
						<div>
							<p class="text-sm font-medium">Hide the referrer</p>
							<p class="text-muted-foreground text-xs">
								The destination never learns which short link sent the visitor.
							</p>
						</div>
						<Switch bind:checked={hideReferrer} />
					</div>

					<div class="border-border flex items-center justify-between rounded-lg border px-3 py-2.5">
						<div>
							<p class="text-sm font-medium">Track conversions</p>
							<p class="text-muted-foreground text-xs">
								Appends <code class="font-mono">clid</code> so outcomes can be reported back.
							</p>
						</div>
						<Switch bind:checked={trackConversions} />
					</div>

					<div class="border-border flex flex-col gap-3 rounded-lg border p-3">
						<div>
							<p class="text-sm font-medium">Mobile deep links</p>
							<p class="text-muted-foreground text-xs">
								Hand matching visitors to a native app, falling back if nothing opens it.
							</p>
						</div>
						<div class="grid gap-2 sm:grid-cols-2">
							<Input bind:value={deepLink.iosUrl} placeholder="iOS app URL — myapp://item/12" />
							<Input bind:value={deepLink.iosFallback} placeholder="App Store URL" />
							<Input
								bind:value={deepLink.androidUrl}
								placeholder="Android app URL — myapp://item/12"
							/>
							<Input bind:value={deepLink.androidFallback} placeholder="Play Store URL" />
						</div>
					</div>
				</Tabs.Content>

				<!-- Advanced ------------------------------------------------------ -->
				<Tabs.Content value="advanced" class="mt-4 flex flex-col gap-4">
					<div class="grid gap-4 sm:grid-cols-2">
						<div class="flex flex-col gap-2">
							<Label for="expiresAt">Expires at</Label>
							<Input id="expiresAt" name="expiresAt" type="datetime-local" bind:value={expiresAt} />
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
								{statuses.find((status) => status.value === redirectStatus)?.label}
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

					<div class="border-border flex items-center justify-between rounded-lg border px-3 py-2.5">
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
