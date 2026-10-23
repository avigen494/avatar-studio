import type { INodeProperties } from 'n8n-workflow';

const showAvatar = { resource: ['avatar'] };

export const avatarOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: showAvatar },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get an avatar',
				description: 'Fetch one avatar (identity) with its looks',
				routing: {
					request: { method: 'GET', url: '=/identities/{{$parameter.identityId}}' },
				},
			},
			{
				name: 'List',
				value: 'list',
				action: 'List avatars',
				description: 'List the avatars (identities) in the workspace',
				routing: {
					request: { method: 'GET', url: '/identities' },
				},
			},
		],
		default: 'list',
	},
];

export const avatarFields: INodeProperties[] = [
	{
		displayName: 'Avatar ID',
		name: 'identityId',
		type: 'string',
		required: true,
		default: '',
		displayOptions: { show: { ...showAvatar, operation: ['get'] } },
	},
];
