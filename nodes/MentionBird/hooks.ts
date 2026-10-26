import {
	NodeApiError,
	sleep,
	type DeclarativeRestApiSettings,
	type IExecutePaginationFunctions,
	type IExecuteSingleFunctions,
	type IN8nHttpFullResponse,
	type INodeExecutionData,
	type JsonObject,
} from 'n8n-workflow';

import { type ApiErrorBody, isListEnvelope, type ListEnvelope } from './transport';

// A rate-limited page is retried only when the API asks for a short wait.
const MAX_RETRY_WAIT_SECONDS = 60;
const MAX_PAGE_RETRIES = 3;

// The "Output" option that scripts/generate.mjs adds to the GET operations'
// "Options" collection.
const wantsWholeResponse = (context: IExecuteSingleFunctions): boolean =>
	context.getNodeParameter('options.output', 'rows') === 'response';

// Requests are sent with ignoreHttpStatusErrors, so that the API's own message
// ({"error": {"code", "message"}}) becomes the message n8n shows. A 429 keeps
// n8n's "too many requests" message, with the API's message as the description,
// and carries the API's Retry-After for paging to wait on.
export async function throwOnApiError(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	if (response.statusCode < 400) {
		return items;
	}
	const apiMessage = (response.body as ApiErrorBody)?.error?.message;
	const httpCode = String(response.statusCode);
	const error = new NodeApiError(this.getNode(), response.body as JsonObject, {
		httpCode,
		itemIndex: this.getItemIndex(),
		...(httpCode === '429' ? { description: apiMessage } : { message: apiMessage }),
	});
	const retryAfter = Number(response.headers['retry-after']);
	if (httpCode === '429' && retryAfter > 0) {
		error.context.retryAfterSeconds = retryAfter;
	}
	throw error;
}

// One n8n item per row of a list response, unless the whole response was asked
// for; any other response stays one item.
export async function splitListEnvelope(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	if (wantsWholeResponse(this)) {
		return items;
	}
	return items.flatMap(({ json }) =>
		isListEnvelope(json) ? json.items.map((row) => ({ json: row })) : [{ json }],
	);
}

const retryWaitSeconds = (error: unknown): number | undefined =>
	error instanceof NodeApiError && error.httpCode === '429'
		? (error.context.retryAfterSeconds as number | undefined)
		: undefined;

// Walks a list endpoint with offset/limit until it has the rows asked for or the
// API reports has_more: false. Each page asks for at most pageSize rows, the most
// that endpoint accepts. The whole-response output is the last page's envelope
// with every page's rows.
export const paginateListEnvelope = (pageSize: number) =>
	async function (
		this: IExecutePaginationFunctions,
		requestData: DeclarativeRestApiSettings.ResultOptions,
	): Promise<INodeExecutionData[]> {
		const returnAll = this.getNodeParameter('returnAll', false) as boolean;
		const wanted = returnAll ? Infinity : (this.getNodeParameter('limit', 50) as number);

		const fetchPage = async (
			offset: number,
			limit: number,
			retriesLeft = MAX_PAGE_RETRIES,
		): Promise<ListEnvelope> => {
			try {
				const [page] = await this.makeRoutingRequest({
					...requestData,
					options: { ...requestData.options, qs: { ...requestData.options.qs, offset, limit } },
				});
				return page.json as ListEnvelope;
			} catch (error) {
				const wait = retryWaitSeconds(error);
				if (wait === undefined || wait > MAX_RETRY_WAIT_SECONDS || retriesLeft === 0) {
					// Returns the error itself when it already is a NodeApiError.
					throw new NodeApiError(this.getNode(), error as JsonObject);
				}
				await sleep(wait * 1000);
				return await fetchPage(offset, limit, retriesLeft - 1);
			}
		};

		const rowCount = (pages: ListEnvelope[]) =>
			pages.reduce((count, page) => count + page.items.length, 0);

		const walk = async (offset: number, pages: ListEnvelope[]): Promise<ListEnvelope[]> => {
			const remaining = wanted - rowCount(pages);
			if (remaining <= 0) {
				return pages;
			}
			const page = await fetchPage(offset, Math.min(pageSize, remaining));
			const walked = [...pages, page];
			return page.has_more && page.items.length
				? await walk(offset + page.items.length, walked)
				: walked;
		};

		const pages = await walk(0, []);
		const rows = pages.flatMap((page) => page.items).slice(0, wanted);
		return wantsWholeResponse(this)
			? [{ json: { ...pages[pages.length - 1], items: rows, returned_count: rows.length } }]
			: rows.map((row) => ({ json: row }));
	};
