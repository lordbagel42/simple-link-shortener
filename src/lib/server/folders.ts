import { and, asc, eq, sql } from 'drizzle-orm';
import { newId } from '@lordbagel42/links-core';
import { getDb } from './db';
import { folder as folderTable, link as linkTable, type Folder } from './db/schema';
import type { Env } from './env';

/**
 * Folders group links for people; tags group them for queries. A link belongs
 * to at most one folder, and deleting a folder leaves its links behind at the
 * top level rather than taking them with it.
 */

export class FolderError extends Error {
	constructor(
		message: string,
		readonly field: string | null = null
	) {
		super(message);
		this.name = 'FolderError';
	}
}

export const FOLDER_COLORS = [
	'slate',
	'red',
	'orange',
	'amber',
	'green',
	'teal',
	'blue',
	'violet',
	'pink'
] as const;

export type FolderWithCount = Folder & { linkCount: number };

/** Folders with their link counts, which is the only way the UI ever shows them. */
export async function listFolders(env: Env, userId: string): Promise<FolderWithCount[]> {
	const db = getDb(env);
	const rows = await db
		.select({
			id: folderTable.id,
			userId: folderTable.userId,
			name: folderTable.name,
			color: folderTable.color,
			createdAt: folderTable.createdAt,
			updatedAt: folderTable.updatedAt,
			linkCount: sql<number>`(
				select count(*) from ${linkTable}
				where ${linkTable.folderId} = ${folderTable.id} and ${linkTable.archived} = false
			)`
		})
		.from(folderTable)
		.where(eq(folderTable.userId, userId))
		.orderBy(asc(folderTable.name));

	return rows;
}

export async function getFolder(env: Env, userId: string, id: string): Promise<Folder | null> {
	const db = getDb(env);
	const [row] = await db
		.select()
		.from(folderTable)
		.where(and(eq(folderTable.id, id), eq(folderTable.userId, userId)))
		.limit(1);
	return row ?? null;
}

export async function createFolder(
	env: Env,
	userId: string,
	input: { name: string; color?: string }
): Promise<Folder> {
	const db = getDb(env);
	const now = new Date();
	const name = validateName(input.name);

	const [clash] = await db
		.select({ id: folderTable.id })
		.from(folderTable)
		.where(and(eq(folderTable.userId, userId), eq(folderTable.name, name)))
		.limit(1);
	if (clash) throw new FolderError(`You already have a folder called "${name}".`, 'name');

	const [created] = await db
		.insert(folderTable)
		.values({ id: newId(), userId, name, color: color(input.color), createdAt: now, updatedAt: now })
		.returning();

	return created!;
}

export async function updateFolder(
	env: Env,
	userId: string,
	id: string,
	input: { name?: string; color?: string }
): Promise<Folder> {
	const db = getDb(env);
	const existing = await getFolder(env, userId, id);
	if (!existing) throw new FolderError('Folder not found.');

	const patch: Partial<Folder> = { updatedAt: new Date() };
	if (input.name !== undefined) patch.name = validateName(input.name);
	if (input.color !== undefined) patch.color = color(input.color);

	const [updated] = await db
		.update(folderTable)
		.set(patch)
		.where(and(eq(folderTable.id, id), eq(folderTable.userId, userId)))
		.returning();

	return updated!;
}

/** The links survive; they just stop being in a folder. */
export async function deleteFolder(env: Env, userId: string, id: string): Promise<void> {
	const db = getDb(env);
	const existing = await getFolder(env, userId, id);
	if (!existing) throw new FolderError('Folder not found.');

	await db
		.update(linkTable)
		.set({ folderId: null })
		.where(and(eq(linkTable.userId, userId), eq(linkTable.folderId, id)));
	await db.delete(folderTable).where(and(eq(folderTable.id, id), eq(folderTable.userId, userId)));
}

function validateName(raw: string): string {
	const name = raw.trim();
	if (!name) throw new FolderError('Folder name is required.', 'name');
	if (name.length > 60) throw new FolderError('Keep folder names under 60 characters.', 'name');
	return name;
}

function color(value: string | undefined): string {
	return value && (FOLDER_COLORS as readonly string[]).includes(value) ? value : 'slate';
}
