import { and, desc, eq } from 'drizzle-orm';
import { getDb } from './db';
import { apiKey } from './db/schema';
import type { Env, WaitUntil } from './env';
import { newId, sha256Hex } from '@lordbagel42/links-core';

const PREFIX = 'lnk_';

export async function listApiKeys(env: Env, userId: string) {
	const db = getDb(env);
	return db
		.select({
			id: apiKey.id,
			name: apiKey.name,
			prefix: apiKey.prefix,
			lastUsedAt: apiKey.lastUsedAt,
			expiresAt: apiKey.expiresAt,
			createdAt: apiKey.createdAt
		})
		.from(apiKey)
		.where(eq(apiKey.userId, userId))
		.orderBy(desc(apiKey.createdAt));
}

export type ApiKeyListItem = Awaited<ReturnType<typeof listApiKeys>>[number];

/** Returns the plaintext token exactly once — only its hash is stored. */
export async function createApiKey(
	env: Env,
	userId: string,
	name: string,
	expiresAt: number | null = null
): Promise<{ token: string; id: string }> {
	const db = getDb(env);
	const token = `${PREFIX}${newId(32)}`;
	const id = newId();

	await db.insert(apiKey).values({
		id,
		userId,
		name: name.trim() || 'Untitled key',
		keyHash: await sha256Hex(token),
		prefix: token.slice(0, PREFIX.length + 6),
		expiresAt: expiresAt ? new Date(expiresAt) : null,
		createdAt: new Date()
	});

	return { token, id };
}

export async function revokeApiKey(env: Env, userId: string, id: string): Promise<void> {
	const db = getDb(env);
	await db.delete(apiKey).where(and(eq(apiKey.id, id), eq(apiKey.userId, userId)));
}

/**
 * Resolve `Authorization: Bearer <token>` to a user id, or `null`.
 * Bumps `lastUsedAt` so stale keys are easy to spot in the dashboard.
 */
export async function userIdFromApiKey(
	env: Env,
	request: Request,
	ctx?: WaitUntil
): Promise<string | null> {
	const header = request.headers.get('authorization');
	if (!header?.startsWith('Bearer ')) return null;

	const token = header.slice('Bearer '.length).trim();
	if (!token.startsWith(PREFIX)) return null;

	const db = getDb(env);
	const [row] = await db
		.select()
		.from(apiKey)
		.where(eq(apiKey.keyHash, await sha256Hex(token)))
		.limit(1);

	if (!row) return null;
	if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

	const touch = db
		.update(apiKey)
		.set({ lastUsedAt: new Date() })
		.where(eq(apiKey.id, row.id))
		.then(() => {});
	if (ctx) ctx.waitUntil(touch);
	else await touch;

	return row.userId;
}
