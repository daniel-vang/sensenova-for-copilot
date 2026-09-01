import vscode from 'vscode';
import { CONFIG_SECTION } from './consts';

export function getApiModelId(vscodeModelId: string): string {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const overrides = config.get<Record<string, string>>('modelIdOverrides');
	const override = overrides?.[vscodeModelId]?.trim();
	return override || vscodeModelId;
}

export function getMaxTokens(): number | undefined {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const value = config.get<number>('maxTokens', 0);
	return value > 0 ? value : undefined;
}

export function getReasoningEffort(): string | undefined {
	const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
	const value = config.get<string>('reasoningEffort', '');
	return value && /^(low|medium|high)$/.test(value) ? value : undefined;
}
