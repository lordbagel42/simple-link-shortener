import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, readJson, requireApiUser } from '$lib/server/api';
import { FolderError, createFolder, listFolders } from '$lib/server/folders';
import { serializeFolder } from '$lib/server/serialize';

export const GET: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const folders = await listFolders(auth.env, auth.userId);
	return json({ folders: folders.map(serializeFolder) });
};

export const POST: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const body = await readJson(event.request);
	if (body instanceof Response) return body;

	try {
		const created = await createFolder(auth.env, auth.userId, {
			name: String(body.name ?? ''),
			color: body.color == null ? undefined : String(body.color)
		});
		return json(serializeFolder(created), { status: 201 });
	} catch (error) {
		if (error instanceof FolderError) return apiError(error.message, 400, error.field);
		throw error;
	}
};
