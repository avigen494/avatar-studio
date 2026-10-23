import type { INodeProperties } from 'n8n-workflow';

export const creditsOperations: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['credit'] } },
		options: [
			{
				name: 'Get Balance',
				value: 'getBalance',
				action: 'Get the credit balance',
				description: 'Return the workspace balance, plan and price per credit',
				routing: {
					request: { method: 'GET', url: '/credits' },
				},
			},
		],
		default: 'getBalance',
	},
];
