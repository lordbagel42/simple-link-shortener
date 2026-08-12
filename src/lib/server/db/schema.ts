/**
 * The Drizzle schema, re-exported from the shared package.
 *
 * Both Workers read the same D1 database, so the table definitions belong with
 * the rest of the shared core rather than in either consumer. This file exists
 * so the app's many `$lib/server/db/schema` imports keep working, and so
 * `drizzle.config.ts` has a stable path to point at.
 */
export * from '@lordbagel42/links-core/schema';
