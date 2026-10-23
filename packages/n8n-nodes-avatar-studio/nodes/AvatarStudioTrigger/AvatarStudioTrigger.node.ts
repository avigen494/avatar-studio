import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { avatarStudioApiRequest } from '../AvatarStudio/GenericFunctions';
import { verifyAvatarStudioSignature } from './verifySignature';

const WEBHOOK_EVENTS = [
	{
		name: 'Identity Verified',
		value: 'identity.verified',
		description: 'A real-person avatar passed consent verification',
	},
	{
		name: 'Look Generated',
		value: 'look.generated',
		description: 'A new look for an avatar is ready',
	},
	{
		name: 'Preview Ready',
		value: 'preview.ready',
		description: 'A free 15 s preview finished',
	},
	{
		name: 'Style Ready',
		value: 'style.ready',
		description: 'Style training for an avatar finished',
	},
	{
		name: 'Video Cancelled',
		value: 'video.cancelled',
		description: 'A render was cancelled',
	},
	{
		name: 'Video Failed',
		value: 'video.failed',
		description: 'A render failed (nothing charged)',
	},
	{
		name: 'Video Succeeded',
		value: 'video.succeeded',
		description: 'A render finished; data.output_url is a signed link valid for one hour',
	},
];

interface StaticData extends IDataObject {
	webhookId?: string;
	webhookSecret?: string;
}

function errorStatus(error: unknown): number | undefined {
	const anyError = error as {
		httpCode?: string | number;
		statusCode?: number;
		cause?: { statusCode?: number };
	};
	const code = anyError?.httpCode ?? anyError?.statusCode ?? anyError?.cause?.statusCode;
	return code === undefined ? undefined : Number(code);
}

export class AvatarStudioTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Avatar Studio Trigger',
		name: 'avatarStudioTrigger',
		icon: 'file:avatarStudio.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description:
			'Starts the workflow when Avatar Studio sends a signed webhook (video finished, preview ready, avatar verified, ...)',
		defaults: {
			name: 'Avatar Studio Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'avatarStudioApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				options: WEBHOOK_EVENTS,
				default: ['video.succeeded'],
				description: 'Which Avatar Studio events start this workflow',
			},
			{
				displayName: 'Registration',
				name: 'registration',
				type: 'options',
				options: [
					{
						name: 'Automatic',
						value: 'auto',
						description:
							'Create the webhook through the API when the workflow is activated and delete it when it is deactivated. The API key must belong to a workspace owner or admin.',
					},
					{
						name: 'Manual',
						value: 'manual',
						description:
							'You create the webhook yourself in Settings > Webhooks using the Production URL of this node and paste its secret below',
					},
				],
				default: 'auto',
			},
			{
				displayName: 'Webhook Secret',
				name: 'secret',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				required: true,
				placeholder: 'whsec_...',
				description: 'The secret shown once when the webhook was created in Avatar Studio',
				displayOptions: { show: { registration: ['manual'] } },
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				options: [
					{
						displayName: 'Description',
						name: 'description',
						type: 'string',
						default: 'n8n',
						description:
							'Label shown on the Avatar Studio Webhooks page (automatic registration only)',
					},
					{
						displayName: 'Include Headers',
						name: 'includeHeaders',
						type: 'boolean',
						default: false,
						description: 'Whether to add the delivery headers to the output item',
					},
					{
						displayName: 'Timestamp Tolerance (Seconds)',
						name: 'tolerance',
						type: 'number',
						default: 300,
						typeOptions: { minValue: 1 },
						description:
							'Reject deliveries whose signed timestamp differs from the current time by more than this',
					},
				],
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const registration = this.getNodeParameter('registration') as string;
				if (registration === 'manual') return true;

				const staticData = this.getWorkflowStaticData('node') as StaticData;
				if (!staticData.webhookId) return false;

				const webhookUrl = this.getNodeWebhookUrl('default');
				const events = [...(this.getNodeParameter('events') as string[])].sort();

				const webhooks = (await avatarStudioApiRequest.call(
					this,
					'GET',
					'/webhooks',
				)) as unknown as IDataObject[];
				const existing = (Array.isArray(webhooks) ? webhooks : []).find(
					(hook) => hook.id === staticData.webhookId,
				);

				if (!existing) {
					delete staticData.webhookId;
					delete staticData.webhookSecret;
					return false;
				}

				const sameUrl = existing.url === webhookUrl;
				const sameEvents =
					JSON.stringify([...((existing.events as string[]) ?? [])].sort()) ===
					JSON.stringify(events);
				if (!sameUrl || !sameEvents || existing.active === false) {
					// Settings changed: drop the stale registration so create() makes a fresh one.
					try {
						await avatarStudioApiRequest.call(this, 'DELETE', `/webhooks/${existing.id}`);
					} catch {
						// ignore; a dangling inactive hook is harmless
					}
					delete staticData.webhookId;
					delete staticData.webhookSecret;
					return false;
				}

				if (typeof existing.secret === 'string' && existing.secret) {
					staticData.webhookSecret = existing.secret;
				}
				return true;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const registration = this.getNodeParameter('registration') as string;
				const webhookUrl = this.getNodeWebhookUrl('default') as string;

				if (registration === 'manual') {
					const secret = this.getNodeParameter('secret', '') as string;
					if (!secret) {
						throw new NodeOperationError(
							this.getNode(),
							'Manual registration needs the webhook secret',
							{
								description: `Create a webhook in Avatar Studio > Settings > Webhooks with the URL ${webhookUrl}, then paste its whsec_... secret into this node.`,
							},
						);
					}
					return true;
				}

				const events = this.getNodeParameter('events') as string[];
				const options = this.getNodeParameter('options', {}) as IDataObject;
				const description = (options.description as string) || 'n8n';

				try {
					const created = await avatarStudioApiRequest.call(this, 'POST', '/webhooks', {
						url: webhookUrl,
						events,
						description,
						active: true,
					});
					const staticData = this.getWorkflowStaticData('node') as StaticData;
					staticData.webhookId = created.id as string;
					staticData.webhookSecret = created.secret as string;
					return true;
				} catch (error) {
					if (errorStatus(error) === 403) {
						throw new NodeOperationError(
							this.getNode(),
							'Avatar Studio refused to create the webhook (403 forbidden)',
							{
								description: `API keys act as workspace editors, and only owners or admins may manage webhooks. Either use a key created by an owner/admin, or switch Registration to "Manual": create the webhook in Settings > Webhooks with the URL ${webhookUrl} and paste its secret into this node.`,
							},
						);
					}
					throw error;
				}
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const registration = this.getNodeParameter('registration') as string;
				if (registration === 'manual') return true;

				const staticData = this.getWorkflowStaticData('node') as StaticData;
				if (staticData.webhookId) {
					try {
						await avatarStudioApiRequest.call(
							this,
							'DELETE',
							`/webhooks/${staticData.webhookId}`,
						);
					} catch (error) {
						if (errorStatus(error) !== 404) return false;
					}
				}
				delete staticData.webhookId;
				delete staticData.webhookSecret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject() as unknown as { rawBody?: Buffer };
		const res = this.getResponseObject();
		const headers = this.getHeaderData() as IDataObject;
		const body = this.getBodyData() as IDataObject;
		const options = this.getNodeParameter('options', {}) as IDataObject;
		const registration = this.getNodeParameter('registration') as string;
		const tolerance = Number(options.tolerance ?? 300) || 300;

		const secret =
			registration === 'manual'
				? (this.getNodeParameter('secret', '') as string)
				: ((this.getWorkflowStaticData('node') as StaticData).webhookSecret ?? '');

		// n8n exposes the untouched request body as req.rawBody; the signature covers those exact bytes.
		const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(body));
		const signatureHeader = headers['x-avatarstudio-signature'] as string | undefined;

		const check = verifyAvatarStudioSignature(secret, rawBody, signatureHeader, tolerance);
		if (!check.ok) {
			res.status(401).json({ error: { code: 'invalid_signature', message: check.reason } });
			return { noWebhookResponse: true };
		}

		// With manual registration the remote webhook may be subscribed to more events than this node wants.
		const events = this.getNodeParameter('events') as string[];
		const event = body.event as string | undefined;
		if (event && event !== 'test.ping' && !events.includes(event)) {
			res.status(200).json({ ok: true, ignored: event });
			return { noWebhookResponse: true };
		}

		const output: IDataObject = {
			...body,
			delivery_id: headers['x-avatarstudio-delivery'] ?? null,
		};
		if (options.includeHeaders) output.headers = headers;

		return {
			workflowData: [this.helpers.returnJsonArray([output])],
		};
	}
}
