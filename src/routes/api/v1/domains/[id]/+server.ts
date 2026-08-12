import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, readJson, requireApiUser } from '$lib/server/api';
import {
	DomainError,
	deleteDomain,
	getDomain,
	updateDomain,
	type DomainInput
} from '$lib/server/domains';
import { serializeDomain } from '$lib/server/serialize';

export const GET: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const domain = await getDomain(auth.env, auth.userId, event.params.id);
	if (!domain) return apiError('Domain not found.', 404);
	return json(serializeDomain(domain));
};

export const PATCH: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const body = await readJson(event.request);
	if (body instanceof Response) return body;

	const patch: Partial<DomainInput> = {};
	if ('hostname' in body) patch.hostname = String(body.hostname);
	if ('label' in body) patch.label = body.label == null ? null : String(body.label);
	if ('prefix' in body) patch.prefix = body.prefix == null ? null : String(body.prefix);
	if ('isDefault' in body) patch.isDefault = Boolean(body.isDefault);
	if ('slugLength' in body) patch.slugLength = Number(body.slugLength);
	if ('redirectStatus' in body) patch.redirectStatus = Number(body.redirectStatus);
	if ('mainRedirect' in body) {
		patch.mainRedirect = body.mainRedirect == null ? null : String(body.mainRedirect);
	}
	if ('notFoundRedirect' in body) {
		patch.notFoundRedirect = body.notFoundRedirect == null ? null : String(body.notFoundRedirect);
	}
	if ('expiredRedirect' in body) {
		patch.expiredRedirect = body.expiredRedirect == null ? null : String(body.expiredRedirect);
	}

	try {
		return json(serializeDomain(await updateDomain(auth.env, auth.userId, event.params.id, patch)));
	} catch (error) {
		if (error instanceof DomainError) {
			return apiError(error.message, error.message === 'Domain not found.' ? 404 : 400, error.field);
		}
		throw error;
	}
};

/** Deleting a domain takes its links with it — the slugs only mean anything inside it. */
export const DELETE: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	try {
		const removed = await deleteDomain(auth.env, auth.userId, event.params.id);
		return json({ deleted: true, linksRemoved: removed });
	} catch (error) {
		if (error instanceof DomainError) {
			return apiError(error.message, error.message === 'Domain not found.' ? 404 : 400, error.field);
		}
		throw error;
	}
};
