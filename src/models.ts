import { logger } from './logger';
import type { ModelDefinition } from './types';

interface ApiModel {
	id: string;
	name?: string;
	context_length?: number;
	max_output_length?: number;
	input_modalities?: string[];
	supported_features?: string[];
	description?: string;
}

interface ModelsResponse {
	data: ApiModel[];
}

const FALLBACK_MODELS: ModelDefinition[] = [
	{ id: 'sensenova-6.8-flash-lite', name: 'SenseNova 6.8 Flash-Lite', family: 'sensenova', version: '6.8', detail: 'Lightweight multimodal agent model', maxInputTokens: 262144, maxOutputTokens: 65536, capabilities: { toolCalling: true, imageInput: true, thinking: true }, requiresThinkingParam: false },
	{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', family: 'deepseek', version: 'v4', detail: 'High-performance reasoning model (1M context)', maxInputTokens: 1048576, maxOutputTokens: 65536, capabilities: { toolCalling: true, imageInput: false, thinking: true }, requiresThinkingParam: false },
	{ id: 'glm-5.2', name: 'GLM-5.2', family: 'glm', version: '5.2', detail: 'Flagship long-context model (1M context, 128K output)', maxInputTokens: 1048576, maxOutputTokens: 131072, capabilities: { toolCalling: true, imageInput: false, thinking: false }, requiresThinkingParam: false },
	{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 PRO', family: 'deepseek', version: 'v4', detail: 'High-performance reasoning model (1M context)', maxInputTokens: 1048576, maxOutputTokens: 65536, capabilities: { toolCalling: true, imageInput: false, thinking: true }, requiresThinkingParam: false },
	{ id: 'kimi-k3', name: 'Kimi K3', family: 'kimi', version: 'k3', detail: 'High-performance multimodal reasoning model (1M context)', maxInputTokens: 1048576, maxOutputTokens: 65536, capabilities: { toolCalling: true, imageInput: true, thinking: true }, requiresThinkingParam: false },
];

function apiModelToDefinition(m: ApiModel): ModelDefinition {
	const f = m.supported_features ?? [];
	const mo = m.input_modalities ?? [];
	return {
		id: m.id, name: m.name || m.id,
		family: m.id.includes('deepseek') ? 'deepseek' : m.id.includes('glm') ? 'glm' : 'sensenova',
		version: '', detail: m.description || m.id,
		maxInputTokens: m.context_length ?? 128000, maxOutputTokens: m.max_output_length ?? 8192,
		capabilities: { toolCalling: f.includes('tools'), imageInput: mo.includes('image'), thinking: f.includes('reasoning') },
		requiresThinkingParam: false,
	};
}

function httpGet(url: string, headers: Record<string, string>, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const https = require('https');
		const http = require('http');
		const parsed = new URL(url);
		const isHttps = parsed.protocol === 'https:';
		const reqFn = isHttps ? https.request : http.request;
		const req = reqFn({
			hostname: parsed.hostname, port: parsed.port || (isHttps ? 443 : 80),
			path: parsed.pathname + parsed.search, method: 'GET', headers, timeout: timeoutMs,
		}, (res: any) => {
			let body = '';
			res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
			res.on('end', () => {
				if (res.statusCode >= 200 && res.statusCode < 300) resolve(body);
				else reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
			});
		});
		req.on('error', reject);
		req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
		req.end();
	});
}

export async function fetchModelsFromApi(baseUrl: string, apiKey: string): Promise<ModelDefinition[]> {
	try {
		logger.info(`Model discovery: fetching ${baseUrl}/models`);
		const body = await httpGet(`${baseUrl}/models`, { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, 15000);
		const data = JSON.parse(body) as ModelsResponse;
		const apiModels = data.data ?? [];
		if (!apiModels.length) { logger.warn('Empty model list, using fallback'); return FALLBACK_MODELS; }
		const models = apiModels.map(apiModelToDefinition);
		logger.info(`Model discovery: ${models.length} models: ${models.map(m => m.id).join(', ')}`);
		return models;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		logger.warn('Model discovery failed, using fallback:', msg);
		return FALLBACK_MODELS;
	}
}

export { FALLBACK_MODELS };
