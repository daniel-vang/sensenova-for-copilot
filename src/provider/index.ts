import vscode from 'vscode';
import { AuthManager } from '../auth';
import { SenseNovaClient } from '../client';
import { getApiModelId, getMaxTokens } from '../config';
import { API_KEY_REQUIRED_DETAIL, DEFAULT_BASE_URL } from '../consts';
import { logger } from '../logger';
import { fetchModelsFromApi, FALLBACK_MODELS } from '../models';
import type { SenseNovaToolCall, ModelDefinition } from '../types';
import { convertMessages, convertTools, countMessageChars, extractSystemPrompt } from './convert';
import { stripImagesIfNeeded } from './vision';

type ModelPickerChatInformation = vscode.LanguageModelChatInformation & {
	readonly isUserSelectable: boolean;
	readonly statusIcon?: vscode.ThemeIcon;
};

export class SenseNovaChatProvider implements vscode.LanguageModelChatProvider {
	private readonly authManager: AuthManager;
	private readonly onDidChangeLanguageModelChatInformationEmitter = new vscode.EventEmitter<void>();
	private isActive = true;

	readonly onDidChangeLanguageModelChatInformation =
		this.onDidChangeLanguageModelChatInformationEmitter.event;

	private cachedModels: ModelDefinition[] | undefined;
	private charsPerToken = 4.0;

	constructor(context: vscode.ExtensionContext) {
		this.authManager = new AuthManager(context);

		context.subscriptions.push(
			this.onDidChangeLanguageModelChatInformationEmitter,
			vscode.workspace.onDidChangeConfiguration((e) => {
				if (e.affectsConfiguration('sensenova-copilot.apiKey')) {
					this.invalidateModelCache();
					this.onDidChangeLanguageModelChatInformationEmitter.fire();
				}
			}),
			context.secrets.onDidChange((e) => {
				if (e.key === 'sensenova-copilot.apiKey') {
					this.invalidateModelCache();
					this.onDidChangeLanguageModelChatInformationEmitter.fire();
				}
			}),
		);
	}

	private invalidateModelCache(): void {
		this.cachedModels = undefined;
	}

	private async getModels(): Promise<ModelDefinition[]> {
		if (this.cachedModels) return this.cachedModels;
		const apiKey = await this.authManager.getApiKey();
		if (!apiKey) return FALLBACK_MODELS;
		const baseUrl = DEFAULT_BASE_URL;
		this.cachedModels = await fetchModelsFromApi(baseUrl, apiKey);
		return this.cachedModels;
	}

	async configureApiKey(): Promise<void> {
		const saved = await this.authManager.promptForApiKey();
		if (saved) {
			this.invalidateModelCache();
			this.onDidChangeLanguageModelChatInformationEmitter.fire();
		}
	}

	async clearApiKey(): Promise<void> {
		await this.authManager.deleteApiKey();
		this.invalidateModelCache();
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
		vscode.window.showInformationMessage('SenseNova API key removed.');
	}

	async hasApiKey(): Promise<boolean> {
		return this.authManager.hasApiKey();
	}

	async prepareForDeactivate(): Promise<void> {
		this.isActive = false;
		this.onDidChangeLanguageModelChatInformationEmitter.fire();
		try {
			await vscode.lm.selectChatModels({ vendor: 'sensenova' });
		} catch { /* ignore */ }
	}

	async provideLanguageModelChatInformation(
		_options: vscode.PrepareLanguageModelChatModelOptions,
		_token: vscode.CancellationToken,
	): Promise<vscode.LanguageModelChatInformation[]> {
		if (!this.isActive) return [];
		const hasKey = await this.authManager.hasApiKey();
		const models = await this.getModels();
		return models.map((model) => toChatInfo(model, hasKey));
	}

	async provideLanguageModelChatResponse(
		modelInfo: vscode.LanguageModelChatInformation,
		messages: readonly vscode.LanguageModelChatRequestMessage[],
		options: vscode.ProvideLanguageModelChatResponseOptions,
		progress: vscode.Progress<vscode.LanguageModelResponsePart>,
		token: vscode.CancellationToken,
	): Promise<void> {
		const apiKey = await this.authManager.getApiKey();
		if (!apiKey) {
			throw new Error('SenseNova API key not configured. Run "SenseNova: Set API Key" from the Command Palette.');
		}

		const baseUrl = DEFAULT_BASE_URL;
		const client = new SenseNovaClient(baseUrl, apiKey);

		const models = await this.getModels();
		const modelDef = models.find((m) => m.id === modelInfo.id);
		const isThinkingModel = modelDef?.capabilities.thinking ?? false;
		const maxTokens = getMaxTokens() ?? 8192;

		const resolvedMessages = stripImagesIfNeeded(messages, modelDef);
		const systemPrompt = extractSystemPrompt(resolvedMessages);
		const anthropicMessages = convertMessages(resolvedMessages);
		const tools = modelDef?.capabilities.toolCalling ? convertTools(options.tools) : undefined;

		const totalRequestChars = countMessageChars(anthropicMessages);

		return new Promise<void>((resolve, reject) => {
			client.streamChatCompletion(
				{
					model: getApiModelId(modelInfo.id),
					max_tokens: maxTokens,
					system: systemPrompt,
					messages: anthropicMessages,
					stream: true,
					tools,
					thinking: isThinkingModel ? { type: 'adaptive' } : undefined,
				},
				{
					onContent: (content: string) => {
						progress.report(new vscode.LanguageModelTextPart(content));
					},

					onThinking: (text: string) => {
						progress.report(
							new vscode.LanguageModelThinkingPart(text) as unknown as vscode.LanguageModelResponsePart,
						);
					},

					onToolCall: (toolCall: SenseNovaToolCall) => {
						progress.report(
							new vscode.LanguageModelToolCallPart(toolCall.id, toolCall.name, toolCall.input),
						);
					},

					onError: (error: Error) => reject(error),
					onDone: () => resolve(),

					onUsage: (usage) => {
						if (totalRequestChars > 0 && usage.input_tokens > 0) {
							const observedRatio = totalRequestChars / usage.input_tokens;
							this.charsPerToken = this.charsPerToken * 0.7 + observedRatio * 0.3;
						}

						const cacheHit = usage.cache_read_input_tokens ?? 0;
						logger.info(
							`tokens: input=${usage.input_tokens} output=${usage.output_tokens}` +
							` | cache_hit=${cacheHit} | chars/tok=${this.charsPerToken.toFixed(2)}`,
						);

						progress.report(
							vscode.LanguageModelDataPart.json({
								prompt_tokens: usage.input_tokens,
								completion_tokens: usage.output_tokens,
								total_tokens: usage.input_tokens + usage.output_tokens,
								prompt_tokens_details: { cached_tokens: cacheHit },
							}, 'usage'),
						);
					},
				},
				token,
			);
		});
	}

	async provideTokenCount(
		_modelInfo: vscode.LanguageModelChatInformation,
		text: string | vscode.LanguageModelChatRequestMessage,
		_token: vscode.CancellationToken,
	): Promise<number> {
		if (typeof text === 'string') {
			return Math.max(1, Math.ceil(text.length / this.charsPerToken));
		}
		if (!text?.content || !Array.isArray(text.content)) return 1;
		let total = 0;
		for (const part of text.content) {
			if (part instanceof vscode.LanguageModelTextPart) total += part.value.length;
		}
		return Math.max(1, Math.ceil(total / this.charsPerToken));
	}
}

function toChatInfo(m: ModelDefinition, hasApiKey: boolean): ModelPickerChatInformation {
	return {
		id: m.id,
		name: m.name,
		family: m.family,
		version: m.version,
		detail: hasApiKey ? m.detail : API_KEY_REQUIRED_DETAIL,
		tooltip: hasApiKey ? undefined : API_KEY_REQUIRED_DETAIL,
		statusIcon: hasApiKey ? undefined : new vscode.ThemeIcon('warning'),
		maxInputTokens: m.maxInputTokens,
		maxOutputTokens: m.maxOutputTokens,
		isUserSelectable: true,
		capabilities: {
			toolCalling: m.capabilities.toolCalling,
			imageInput: m.capabilities.imageInput,
		},
	};
}
