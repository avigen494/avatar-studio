import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { avatarFields, avatarOperations } from './descriptions/AvatarDescription';
import { creditsOperations } from './descriptions/CreditsDescription';
import { videoFields, videoOperations } from './descriptions/VideoDescription';
import { voiceOperations } from './descriptions/VoiceDescription';
import { avatarStudioApiRequest } from './GenericFunctions';

export class AvatarStudio implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Avatar Studio',
		name: 'avatarStudio',
		icon: 'file:avatarStudio.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Create AI avatar videos, estimate credits and look up avatars and voices',
		defaults: {
			name: 'Avatar Studio',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [
			{
				name: 'avatarStudioApi',
				required: true,
			},
		],
		requestDefaults: {
			baseURL: '={{$credentials.baseUrl}}',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Avatar', value: 'avatar' },
					{ name: 'Credit', value: 'credit' },
					{ name: 'Video', value: 'video' },
					{ name: 'Voice', value: 'voice' },
				],
				default: 'video',
			},
			...videoOperations,
			...videoFields,
			...avatarOperations,
			...avatarFields,
			...voiceOperations,
			...creditsOperations,
		],
	};

	methods = {
		loadOptions: {
			async getIdentities(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const identities = (await avatarStudioApiRequest.call(
					this,
					'GET',
					'/identities',
				)) as unknown as IDataObject[];
				return (Array.isArray(identities) ? identities : [])
					.map((identity) => ({
						name: identity.can_render
							? String(identity.name)
							: `${identity.name} (not ready: ${identity.consent_status ?? identity.status})`,
						value: String(identity.id),
						description: `${identity.kind} / ${identity.status}`,
					}))
					.sort((a, b) => a.name.localeCompare(b.name));
			},

			async getVoices(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const voices = (await avatarStudioApiRequest.call(
					this,
					'GET',
					'/voices',
				)) as unknown as IDataObject[];
				return (Array.isArray(voices) ? voices : [])
					.map((voice) => ({
						name: `${voice.name}${voice.is_default ? ' (default)' : ''}`,
						value: String(voice.id),
						description: `${voice.engine} / ${voice.language}${voice.gender ? ` / ${voice.gender}` : ''}`,
					}))
					.sort((a, b) => a.name.localeCompare(b.name));
			},
		},
	};
}
