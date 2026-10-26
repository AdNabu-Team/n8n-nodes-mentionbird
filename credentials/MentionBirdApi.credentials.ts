import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

import { API_BASE_URL_EXPRESSION } from '../nodes/MentionBird/transport';

export class MentionBirdApi implements ICredentialType {
	name = 'mentionBirdApi';

	displayName = 'MentionBird API';

	icon = {
		light: 'file:../nodes/MentionBird/mentionbird.svg',
		dark: 'file:../nodes/MentionBird/mentionbird.dark.svg',
	} as const;

	documentationUrl = 'https://docs.mentionbird.ai/authentication/';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description:
				'A MentionBird API key, created on the API & integrations page. The Add operations need a key with write access.',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			required: true,
			default: 'https://api.mentionbird.ai',
			description:
				"The MentionBird API's address. Keep the default unless MentionBird gave you another one.",
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: API_BASE_URL_EXPRESSION,
			url: '/brands/tracked',
		},
	};
}
