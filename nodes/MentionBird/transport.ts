import type { IDataObject, ILoadOptionsFunctions } from 'n8n-workflow';

export const CREDENTIAL_TYPE = 'mentionBirdApi';

export type ListEnvelope<T = IDataObject> = {
	items: T[];
	total_count: number;
	returned_count: number;
	has_more: boolean;
};

export interface ApiErrorBody {
	error?: { code?: string; message?: string };
}

// The credential's base URL, tolerating a trailing slash or a pasted "/api/v1".
// The expression and the function must stay in step: requests built by n8n's
// routing use the expression, requests made from code use the function.
export const API_BASE_URL_EXPRESSION =
	'={{ $credentials.baseUrl.trim().replace(/\\/+$/, "").replace(/\\/api\\/v1$/, "") }}/api/v1';

export const apiBaseUrl = (baseUrl: string): string =>
	`${baseUrl
		.trim()
		.replace(/\/+$/, '')
		.replace(/\/api\/v1$/, '')}/api/v1`;

export const isListEnvelope = (body: unknown): body is ListEnvelope =>
	typeof body === 'object' &&
	body !== null &&
	Array.isArray((body as ListEnvelope).items) &&
	typeof (body as ListEnvelope).has_more === 'boolean';

export const apiGet = async <T>(context: ILoadOptionsFunctions, path: string): Promise<T> => {
	const { baseUrl } = await context.getCredentials<{ baseUrl: string }>(CREDENTIAL_TYPE);
	return (await context.helpers.httpRequestWithAuthentication.call(context, CREDENTIAL_TYPE, {
		method: 'GET',
		url: `${apiBaseUrl(baseUrl)}${path}`,
		json: true,
	})) as T;
};
