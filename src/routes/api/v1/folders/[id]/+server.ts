import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, readJson, requireApiUser } from '$lib/server/api';
import { FolderError, deleteFolder, updateFolder } from '$lib/server/folders';
import { serializeFolder } from '$lib/server/serialize';

export const PATCH: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const body = await readJson(event.request);
	if (body instanceof Response) return body;

	try {
		const updated = await updateFolder(auth.env, auth.userId, event.params.id, {
			name: 'name' in body ? String(body.name) : undefined,
			color: 'color' in body ? String(body.color) : undefined
		});
		return json(serializeFolder(updated));
	} catch (error) {
		if (error instanceof FolderError) {
			return apiError(error.message, error.message === 'Folder not found.' ? 404 : 400, error.field);
		}
		throw error;
	}
};

/** The folder's links survive; they just stop being in a folder. */
export const DELETE: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	try {
		await deleteFolder(auth.env, auth.userId, event.params.id);
		return new Response(null, { status: 204 });
	} catch (error) {
		if (error instanceof FolderError) return apiError(error.message, 404);
		throw error;
	}
};
