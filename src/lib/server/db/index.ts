import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { schema } from './schema';
import type { Env } from '$lib/server/env';

export type Db = DrizzleD1Database<typeof schema>;

const cache = new WeakMap<D1Database, Db>();

/**
 * Drizzle client for the request's D1 binding. Cached per binding instance so
 * repeated calls inside one request don't rebuild the query builder.
 */
export function getDb(env: Env): Db {
	if (!env.DB) {
		throw new Error(
			'D1 binding `DB` is missing. Create the database and fill in `d1_databases` in wrangler.jsonc.'
		);
	}
	const existing = cache.get(env.DB);
	if (existing) return existing;

	const db = drizzle(env.DB, { schema, casing: 'snake_case' });
	cache.set(env.DB, db);
	return db;
}

export { schema };
export * from './schema';
