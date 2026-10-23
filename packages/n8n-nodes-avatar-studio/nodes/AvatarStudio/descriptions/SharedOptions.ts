import type { INodePropertyOptions } from 'n8n-workflow';

export const languageOptions: INodePropertyOptions[] = [
	{ name: 'English', value: 'en' },
	{ name: 'Hindi', value: 'hi' },
	{ name: 'Hinglish', value: 'hinglish' },
];

export const aspectOptions: INodePropertyOptions[] = [
	{ name: '9:16 (Portrait)', value: '9:16' },
	{ name: '16:9 (Landscape)', value: '16:9' },
	{ name: '1:1 (Square)', value: '1:1' },
];

export const qualityOptions: INodePropertyOptions[] = [
	{ name: '720p', value: '720p' },
	{ name: '1080p', value: '1080p' },
	{ name: '4K', value: '4k' },
];

export const engineModeOptions: INodePropertyOptions[] = [
	{ name: 'Auto', value: 'auto' },
	{ name: 'Mouth Only', value: 'mouth_only' },
	{ name: 'Photo', value: 'photo' },
	{ name: 'Real Footage', value: 'real_footage' },
];

export const voiceStyleOptions: INodePropertyOptions[] = [
	{ name: 'Energetic', value: 'energetic' },
	{ name: 'Neutral', value: 'neutral' },
	{ name: 'Serious', value: 'serious' },
	{ name: 'Warm', value: 'warm' },
];

export const expressionOptions: INodePropertyOptions[] = [
	{ name: 'Calm', value: 'calm' },
	{ name: 'Confident', value: 'confident' },
	{ name: 'Enthusiastic', value: 'enthusiastic' },
	{ name: 'Serious', value: 'serious' },
	{ name: 'Smile', value: 'smile' },
];

export const gestureOptions: INodePropertyOptions[] = [
	{ name: 'Hand on Heart', value: 'hand_on_heart' },
	{ name: 'None', value: 'none' },
	{ name: 'Open Palms', value: 'open_palms' },
	{ name: 'Point', value: 'point' },
	{ name: 'Thumbs Up', value: 'thumbs_up' },
	{ name: 'Wave', value: 'wave' },
];

export const gazeOptions: INodePropertyOptions[] = [
	{ name: 'Ahead', value: 'ahead' },
	{ name: 'Camera', value: 'camera' },
];

export const videoStatusOptions: INodePropertyOptions[] = [
	{ name: 'Cancelled', value: 'cancelled' },
	{ name: 'Draft', value: 'draft' },
	{ name: 'Failed', value: 'failed' },
	{ name: 'Queued', value: 'queued' },
	{ name: 'Rendering', value: 'rendering' },
	{ name: 'Succeeded', value: 'succeeded' },
];
