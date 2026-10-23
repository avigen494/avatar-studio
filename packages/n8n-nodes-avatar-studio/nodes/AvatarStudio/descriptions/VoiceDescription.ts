import type { INodeProperties } from 'n8n-workflow';

export const voiceOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['voice'] } },
		options: [
			{
				name: 'List',
				value: 'list',
				action: 'List voices',
				description: 'List the voices available to the workspace',
				routing: {
					request: { method: 'GET', url: '/voices' },
				},
			},
		],
		default: 'list',
	},
];
