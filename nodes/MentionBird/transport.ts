import {
	NodeApiError,
	type IDataObject,
	type ILoadOptionsFunctions,
	type IN8nHttpFullResponse,
	type INode,
	type IPollFunctions,
	type JsonObject,
} from 'n8n-workflow';

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

// The error n8n shows for a failed request: the API's own message from its
// {"error": {"code", "message"}} envelope. A 429 keeps n8n's "too many
// requests" message, with the API's message as the description, and carries
// the API's Retry-After for paging to wait on.
export const apiError = (
	node: INode,
	response: IN8nHttpFullResponse,
	itemIndex?: number,
): NodeApiError => {
	const apiMessage = (response.body as ApiErrorBody)?.error?.message;
	const httpCode = String(response.statusCode);
	const error = new NodeApiError(node, response.body as JsonObject, {
		httpCode,
		itemIndex,
		...(httpCode === '429' ? { description: apiMessage } : { message: apiMessage }),
	});
	const retryAfter = Number(response.headers['retry-after']);
	if (httpCode === '429' && retryAfter > 0) {
		error.context.retryAfterSeconds = retryAfter;
	}
	return error;
};

export const apiGet = async <T>(
	context: ILoadOptionsFunctions | IPollFunctions,
	path: string,
	qs: IDataObject = {},
): Promise<T> => {
	const { baseUrl } = await context.getCredentials<{ baseUrl: string }>(CREDENTIAL_TYPE);
	const response = (await context.helpers.httpRequestWithAuthentication.call(
		context,
		CREDENTIAL_TYPE,
		{
			method: 'GET',
			url: `${apiBaseUrl(baseUrl)}${path}`,
			qs,
			json: true,
			ignoreHttpStatusErrors: true,
			returnFullResponse: true,
		},
	)) as IN8nHttpFullResponse;
	if (response.statusCode >= 400) {
		throw apiError(context.getNode(), response);
	}
	return response.body as T;
};
