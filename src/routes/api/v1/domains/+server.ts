import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, readJson, requireApiUser } from '$lib/server/api';
import { DomainError, createDomain, domainLinkCounts, listDomains } from '$lib/server/domains';
import { serializeDomain } from '$lib/server/serialize';

export const GET: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const [domains, counts] = await Promise.all([
		listDomains(auth.env, auth.userId),
		domainLinkCounts(auth.env, auth.userId)
	]);

	return json({ domains: domains.map((row) => serializeDomain(row, counts[row.id] ?? 0)) });
};

export const POST: RequestHandler = async (event) => {
	const auth = await requireApiUser(event);
	if (auth instanceof Response) return auth;

	const body = await readJson(event.request);
	if (body instanceof Response) return body;

	try {
		const created = await createDomain(auth.env, auth.userId, {
			hostname: String(body.hostname ?? ''),
			label: body.label == null ? null : String(body.label),
			prefix: body.prefix == null ? null : String(body.prefix),
			isDefault: body.isDefault === undefined ? undefined : Boolean(body.isDefault),
			slugLength: body.slugLength == null ? undefined : Number(body.slugLength),
			redirectStatus: body.redirectStatus == null ? undefined : Number(body.redirectStatus),
			mainRedirect: body.mainRedirect == null ? null : String(body.mainRedirect),
			notFoundRedirect: body.notFoundRedirect == null ? null : String(body.notFoundRedirect),
			expiredRedirect: body.expiredRedirect == null ? null : String(body.expiredRedirect)
		});
		return json(serializeDomain(created), { status: 201 });
	} catch (error) {
		if (error instanceof DomainError) return apiError(error.message, 400, error.field);
		throw error;
	}
};
