import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class AvatarStudioApi implements ICredentialType {
	name = 'avatarStudioApi';

	displayName = 'Avatar Studio API';

	documentationUrl = 'https://api.avatarstudio.example/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.avatarstudio.example',
			placeholder: 'https://api.avatarstudio.example',
			description:
				'Root of the Avatar Studio API without a trailing slash. Use http://localhost:8000 for a local instance.',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Create one in Settings → API keys (it looks like ask_live_…). The read scope covers Get and List; Create, Generate, Cancel and Batch need the write scope.',
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
			baseURL: '={{$credentials.baseUrl}}',
			url: '/credits',
			method: 'GET',
		},
	};
}
