<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { Link2, ChevronDown, LogOut, Settings, Moon, Sun, BookOpen } from '@lucide/svelte';
	import { toggleMode, mode } from 'mode-watcher';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Avatar from '$lib/components/ui/avatar';
	import { Button } from '$lib/components/ui/button';
	import { signOut } from '$lib/auth-client';

	let { children, data } = $props();

	const tabs = [
		{ href: '/', label: 'Overview' },
		{ href: '/analytics', label: 'Analytics' },
		{ href: '/settings', label: 'Settings' }
	];

	function isActive(href: string): boolean {
		return href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
	}

	const initials = $derived(
		(data.user?.name ?? data.user?.email ?? '?')
			.split(/[\s@.]+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((part: string) => part[0]?.toUpperCase())
			.join('')
	);

	async function handleSignOut() {
		await signOut();
		await goto('/login', { invalidateAll: true });
	}
</script>

<div class="flex min-h-dvh flex-col">
	<header class="bg-background sticky top-0 z-40">
		<div class="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6">
			<a href="/" class="flex items-center gap-2.5" aria-label="Links home">
				<span
					class="bg-foreground text-background flex size-7 items-center justify-center rounded-lg"
				>
					<Link2 class="size-4" />
				</span>
			</a>

			<span class="text-border select-none" aria-hidden="true">/</span>

			<div class="flex min-w-0 items-center gap-2">
				<span class="truncate text-sm font-medium">{data.user?.name ?? 'Links'}</span>
				<span
					class="border-border text-muted-foreground hidden rounded-full border px-2 py-0.5 text-[11px] sm:inline"
				>
					Hobby
				</span>
			</div>

			<div class="ml-auto flex items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					class="text-muted-foreground hover:text-foreground hidden sm:inline-flex"
					href="https://developers.cloudflare.com/workers/"
					target="_blank"
					rel="noreferrer noopener"
				>
					<BookOpen class="size-4" />
					Docs
				</Button>

				<Button
					variant="ghost"
					size="icon"
					class="text-muted-foreground hover:text-foreground size-8"
					onclick={toggleMode}
					aria-label="Toggle theme"
				>
					{#if mode.current === 'dark'}
						<Sun class="size-4" />
					{:else}
						<Moon class="size-4" />
					{/if}
				</Button>

				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<button {...props} class="ml-1 flex items-center gap-1 rounded-full outline-none">
								<Avatar.Root class="size-7">
									{#if data.user?.image}
										<Avatar.Image src={data.user.image} alt={data.user.name} />
									{/if}
									<Avatar.Fallback class="text-[11px]">{initials}</Avatar.Fallback>
								</Avatar.Root>
								<ChevronDown class="text-muted-foreground size-3.5" />
							</button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="w-56">
						<div class="px-2 py-1.5">
							<p class="truncate text-sm font-medium">{data.user?.name}</p>
							<p class="text-muted-foreground truncate text-xs">{data.user?.email}</p>
						</div>
						<DropdownMenu.Separator />
						<DropdownMenu.Item onSelect={() => goto('/settings')}>
							<Settings class="size-4" />
							Settings
						</DropdownMenu.Item>
						<DropdownMenu.Separator />
						<DropdownMenu.Item onSelect={handleSignOut}>
							<LogOut class="size-4" />
							Sign out
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		</div>

		<nav class="border-border border-b">
			<div class="mx-auto flex w-full max-w-7xl gap-1 px-4 sm:px-6">
				{#each tabs as tab (tab.href)}
					<a
						href={tab.href}
						class="relative -mb-px px-3 py-2.5 text-sm transition-colors
							{isActive(tab.href) ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}"
					>
						{tab.label}
						{#if isActive(tab.href)}
							<span class="bg-foreground absolute inset-x-0 -bottom-px h-0.5 rounded-full"></span>
						{/if}
					</a>
				{/each}
			</div>
		</nav>
	</header>

	<main class="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
		{@render children()}
	</main>

	<footer class="border-border mt-auto border-t">
		<div
			class="text-muted-foreground mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-6 text-xs sm:px-6"
		>
			<span>Running on Cloudflare Workers, D1, and KV.</span>
			<span class="ml-auto font-mono">{data.shortBase}/…</span>
		</div>
	</footer>
</div>
