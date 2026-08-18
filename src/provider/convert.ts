import vscode from 'vscode';
import type { SenseNovaContentPart, SenseNovaMessage, SenseNovaTool } from '../types';

// `System` was present in some proposed VS Code API typings, but it is not
// part of the current stable LanguageModelChatMessageRole enum. Keep support
// for runtimes that still expose it without making the project depend on that
// removed type member.
const systemMessageRole = (
	(vscode.LanguageModelChatMessageRole as unknown) as {
		System?: vscode.LanguageModelChatMessageRole;
	}
).System;

/**
 * Convert VS Code chat messages to Anthropic Messages API format.
 */
export function convertMessages(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): SenseNovaMessage[] {
	const result: SenseNovaMessage[] = [];

	for (const message of messages) {
		if (systemMessageRole !== undefined && message.role === systemMessageRole) {
			continue;
		}

		const role = message.role === vscode.LanguageModelChatMessageRole.Assistant ? 'assistant' : 'user';
		let textContent = '';
		const parts: SenseNovaContentPart[] = [];

		for (const part of message.content) {
			if (part instanceof vscode.LanguageModelTextPart) {
				textContent += part.value;
			} else if (part instanceof vscode.LanguageModelDataPart) {
				if (part.mimeType.startsWith('image/')) {
					const base64 = Buffer.from(part.data).toString('base64');
					parts.push({
						type: 'image',
						source: { type: 'base64', media_type: part.mimeType, data: base64 },
					});
				}
			} else if (part instanceof vscode.LanguageModelToolCallPart) {
				// Tool calls are handled separately in the provider
				continue;
			} else if (part instanceof vscode.LanguageModelToolResultPart) {
				let toolContent = '';
				for (const item of part.content) {
					if (item instanceof vscode.LanguageModelTextPart) {
						toolContent += item.value;
					}
				}
				result.push({
					role: 'user',
					content: [{
						type: 'text',
						text: toolContent || JSON.stringify(part.content),
					}],
				});
				continue;
			}
		}

		if (parts.length > 0 && textContent) {
			parts.unshift({ type: 'text', text: textContent });
			result.push({ role, content: parts });
		} else if (parts.length > 0) {
			result.push({ role, content: parts });
		} else if (textContent) {
			result.push({ role, content: textContent });
		}
	}

	return result;
}

/**
 * Extract system prompt from VS Code messages.
 */
export function extractSystemPrompt(
	messages: readonly vscode.LanguageModelChatRequestMessage[],
): string | undefined {
	const systemParts: string[] = [];
	for (const message of messages) {
		if (systemMessageRole !== undefined && message.role === systemMessageRole) {
			for (const part of message.content) {
				if (part instanceof vscode.LanguageModelTextPart) {
					systemParts.push(part.value);
				}
			}
		}
	}
	return systemParts.length > 0 ? systemParts.join('\n') : undefined;
}

/**
 * Convert VS Code tool definitions to Anthropic format.
 */
export function convertTools(
	tools: readonly vscode.LanguageModelChatTool[] | undefined,
): SenseNovaTool[] | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		input_schema: tool.inputSchema as Record<string, unknown> | undefined,
	}));
}

/**
 * Count total characters across all messages to calibrate chars-per-token ratio.
 */
export function countMessageChars(messages: SenseNovaMessage[]): number {
	let total = 0;
	for (const msg of messages) {
		if (typeof msg.content === 'string') {
			total += msg.content.length;
		} else if (Array.isArray(msg.content)) {
			for (const part of msg.content) {
				if (part.type === 'text') total += part.text.length;
			}
		}
	}
	return total;
}
