import type {
	IDataObject,
	IExecuteSingleFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IN8nHttpFullResponse,
	INodeExecutionData,
	IWebhookFunctions,
} from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';

export const CREDENTIAL_NAME = 'avatarStudioApi';

/** Statuses after which a video will not change any more. */
export const TERMINAL_STATUSES = ['succeeded', 'failed', 'cancelled'];

/** How often "Wait for Completion" polls GET /videos/{id}. */
export const POLL_INTERVAL_MS = 5000;

type RequestContext =
	| IExecuteSingleFunctions
	| IHookFunctions
	| IWebhookFunctions
	| ILoadOptionsFunctions;

/**
 * Authenticated request against the Avatar Studio API using the stored credential.
 * Used by the hooks that need more than the single declarative request
 * (generate-after-create, polling, webhook registration, dropdowns).
 */
export async function avatarStudioApiRequest(
	this: RequestContext,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
	qs?: IDataObject,
	headers?: IDataObject,
): Promise<IDataObject> {
	const credentials = await this.getCredentials(CREDENTIAL_NAME);
	const baseUrl = String(credentials.baseUrl ?? '').replace(/\/+$/, '');

	const options: IHttpRequestOptions = {
		method,
		url: `${baseUrl}${endpoint}`,
		json: true,
		headers: { Accept: 'application/json', ...(headers ?? {}) },
	};
	if (body && Object.keys(body).length > 0) options.body = body;
	if (qs && Object.keys(qs).length > 0) options.qs = qs;

	const response = await this.helpers.httpRequestWithAuthentication.call(
		this,
		CREDENTIAL_NAME,
		options,
	);
	return (response ?? {}) as IDataObject;
}

/**
 * Poll GET /videos/{id} every POLL_INTERVAL_MS until the status is terminal or
 * the configured timeout (minutes) elapses. Returns the final video object.
 */
export async function waitForVideo(
	this: IExecuteSingleFunctions,
	video: IDataObject,
): Promise<IDataObject> {
	const timeoutMinutes = Number(this.getNodeParameter('waitTimeout', 15)) || 15;
	const deadline = Date.now() + timeoutMinutes * 60_000;
	let current = video;

	while (!TERMINAL_STATUSES.includes(String(current.status))) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			throw new NodeOperationError(
				this.getNode(),
				`Timed out after ${timeoutMinutes} minute(s) waiting for video ${current.id} (last status: ${current.status}, stage: ${current.stage ?? 'unknown'})`,
				{
					itemIndex: this.getItemIndex(),
					description:
						'Increase "Wait Timeout", or turn "Wait for Completion" off and use the Avatar Studio Trigger node with the video.succeeded event instead.',
				},
			);
		}
		await sleep(Math.min(POLL_INTERVAL_MS, remaining));
		current = await avatarStudioApiRequest.call(this, 'GET', `/videos/${current.id}`);
	}
	return current;
}

/**
 * postReceive for Video → Create. If "Generate Now" is on, queue the render and,
 * if "Wait for Completion" is on, poll until it finishes.
 */
export async function afterVideoCreate(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	_response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const generateNow = this.getNodeParameter('generateNow', false) as boolean;
	if (!generateNow) return items;
	const wait = this.getNodeParameter('waitForCompletion', false) as boolean;

	const out: INodeExecutionData[] = [];
	for (const item of items) {
		const id = item.json.id as string | undefined;
		if (!id) {
			out.push(item);
			continue;
		}
		let video = await avatarStudioApiRequest.call(this, 'POST', `/videos/${id}/generate`);
		if (wait) video = await waitForVideo.call(this, video);
		out.push({ json: video, pairedItem: item.pairedItem });
	}
	return out;
}

/** postReceive for Video → Generate: optionally poll until the render finishes. */
export async function afterVideoGenerate(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	_response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const wait = this.getNodeParameter('waitForCompletion', false) as boolean;
	if (!wait) return items;

	const out: INodeExecutionData[] = [];
	for (const item of items) {
		if (!item.json.id) {
			out.push(item);
			continue;
		}
		const video = await waitForVideo.call(this, item.json as IDataObject);
		out.push({ json: video, pairedItem: item.pairedItem });
	}
	return out;
}

/**
 * preSend for Video → Batch: accept the "Items" parameter as a JSON string or an
 * already-parsed array (expressions), validate it and put it on the body.
 */
export async function prepareBatchBody(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const raw = this.getNodeParameter('items') as unknown;
	let items: unknown = raw;
	if (typeof raw === 'string') {
		try {
			items = JSON.parse(raw);
		} catch (error) {
			throw new NodeOperationError(this.getNode(), 'Items must be a valid JSON array', {
				itemIndex: this.getItemIndex(),
				description: 'Example: [{"script":"Hi Aman","title":"Aman","idempotency_key":"lead-1"}]',
			});
		}
	}
	if (!Array.isArray(items) || items.length === 0) {
		throw new NodeOperationError(this.getNode(), 'Items must be a non-empty JSON array', {
			itemIndex: this.getItemIndex(),
		});
	}
	if (items.length > 100) {
		throw new NodeOperationError(
			this.getNode(),
			`A batch holds at most 100 items (received ${items.length})`,
			{ itemIndex: this.getItemIndex() },
		);
	}
	for (const [index, item] of items.entries()) {
		if (typeof item !== 'object' || item === null || typeof (item as IDataObject).script !== 'string') {
			throw new NodeOperationError(
				this.getNode(),
				`Batch item ${index} needs a "script" string`,
				{ itemIndex: this.getItemIndex() },
			);
		}
	}

	const body = ((requestOptions.body as IDataObject | undefined) ?? {}) as IDataObject;
	body.items = items as IDataObject[];
	requestOptions.body = body;
	return requestOptions;
}
