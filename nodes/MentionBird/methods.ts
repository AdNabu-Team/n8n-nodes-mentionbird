import type {
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
} from 'n8n-workflow';

import { apiGet, type ListEnvelope } from './transport';

interface TrackedBrand {
	brand: string;
	domain: string | null;
}

interface AiPlatform {
	provider: string;
	display_name: string;
}

export async function searchBrands(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<INodeListSearchResult> {
	const { items } = await apiGet<ListEnvelope<TrackedBrand>>(this, '/brands/tracked');
	const needle = filter?.trim().toLowerCase() ?? '';
	return {
		results: items
			.filter(({ brand }) => brand.toLowerCase().includes(needle))
			.map(({ brand, domain }) => ({
				name: brand,
				value: brand,
				description: domain ?? undefined,
			})),
	};
}

export async function getAiPlatforms(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const { items } = await apiGet<ListEnvelope<AiPlatform>>(this, '/llm-providers');
	return items.map(({ provider, display_name }) => ({ name: display_name, value: provider }));
}
