import vscode from 'vscode';
import { WALKTHROUGH_ID, WELCOME_SHOWN_KEY } from './consts';
import { logger } from './logger';
import { SenseNovaChatProvider } from './provider';

let activeProvider: SenseNovaChatProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
	logger.info('Activating extension');

	context.subscriptions.push(
		vscode.commands.registerCommand('sensenova-copilot.showLogs', () => logger.show()),
		vscode.commands.registerCommand('sensenova-copilot.getApiKey', () =>
			vscode.env.openExternal(vscode.Uri.parse('https://platform.sensenova.cn')),
		),
		vscode.commands.registerCommand('sensenova-copilot.openSettings', () =>
			vscode.commands.executeCommand('workbench.action.openSettings', 'sensenova-copilot'),
		),
	);

	try {
		const provider = new SenseNovaChatProvider(context);
		activeProvider = provider;

		context.subscriptions.push(
			vscode.commands.registerCommand('sensenova-copilot.setApiKey', () => provider.configureApiKey()),
			vscode.commands.registerCommand('sensenova-copilot.clearApiKey', () => provider.clearApiKey()),
			vscode.lm.registerLanguageModelChatProvider('sensenova', provider),
		);

		void showWelcomeIfNeeded(context, provider).catch((error) => {
			logger.warn('Failed to show SenseNova welcome prompt', error);
		});

		logger.info('Extension activated');
	} catch (error) {
		activeProvider = undefined;
		logger.error('Failed to activate SenseNova extension', error);
		void vscode.window.showErrorMessage(
			'SenseNova failed to activate. Run "SenseNova: Show Logs" for details.',
		);
		throw error;
	}
}

async function showWelcomeIfNeeded(
	context: vscode.ExtensionContext,
	provider: SenseNovaChatProvider,
): Promise<void> {
	if (context.globalState.get<boolean>(WELCOME_SHOWN_KEY)) {
		return;
	}
	if (await provider.hasApiKey()) {
		await context.globalState.update(WELCOME_SHOWN_KEY, true);
		return;
	}

	await vscode.commands.executeCommand('workbench.action.openWalkthrough', WALKTHROUGH_ID, false);
	await context.globalState.update(WELCOME_SHOWN_KEY, true);
}

export async function deactivate() {
	try {
		await activeProvider?.prepareForDeactivate();
	} catch (error) {
		logger.warn('Failed to prepare SenseNova provider for deactivate', error);
	} finally {
		activeProvider = undefined;
		logger.info('Extension deactivated');
		logger.dispose();
	}
}
