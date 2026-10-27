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

	// n8n shows only the HTTP status text when a test fails, never the API's
	// message. From MentionBird's API, a 403 on this endpoint always means the
	// key is valid but its workspace's plan has no API access. n8n can't tell
	// that 403 from one sent by a proxy or another host, so those get the same
	// message.
	test: ICredentialTestRequest = {
		request: {
			baseURL: API_BASE_URL_EXPRESSION,
			url: '/brands/tracked',
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 403,
					message:
						"This key's workspace is on a plan without API access. Upgrade that workspace's MentionBird plan to use this key.",
				},
			},
		],
	};
}
