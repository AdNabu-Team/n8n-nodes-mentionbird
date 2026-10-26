import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from 'n8n-workflow';

import { operationProperties, resourceProperty, subtitle } from './generated/properties';
import { getAiPlatforms, searchBrands } from './methods';
import { API_BASE_URL_EXPRESSION, CREDENTIAL_TYPE } from './transport';

export class MentionBird implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'MentionBird',
		name: 'mentionBird',
		icon: { light: 'file:mentionbird.svg', dark: 'file:mentionbird.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle,
		description:
			'Read how your brand shows up in AI answers on MentionBird, and add brands and prompts to track',
		defaults: {
			name: 'MentionBird',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: CREDENTIAL_TYPE, required: true }],
		requestDefaults: {
			baseURL: API_BASE_URL_EXPRESSION,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			ignoreHttpStatusErrors: true,
		},
		properties: [resourceProperty, ...operationProperties],
	};

	methods = {
		listSearch: { searchBrands },
		loadOptions: { getAiPlatforms },
	};
}
