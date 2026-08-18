import type { CancellationToken } from 'vscode';
import { logger } from './logger';
import type {
	SenseNovaRequest,
	SenseNovaStreamEvent,
	SenseNovaToolCall,
	StreamCallbacks,
} from './types';

export class SenseNovaClient {
	constructor(
		private readonly baseUrl: string,
		private readonly apiKey: string,
	) {}

	async streamChatCompletion(
		request: SenseNovaRequest,
		callbacks: StreamCallbacks,
		cancellationToken?: CancellationToken,
	): Promise<void> {
		try {
			const url = `${this.baseUrl}/messages`;
			const body = JSON.stringify(request);
			await this.doPost(url, body, callbacks, cancellationToken);
		} catch (error) {
			if (cancellationToken?.isCancellationRequested) {
				callbacks.onDone();
				return;
			}
			callbacks.onError(error instanceof Error ? error : new Error(String(error)));
		}
	}

	private doPost(
		url: string,
		body: string,
		callbacks: StreamCallbacks,
		cancellationToken?: CancellationToken,
	): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const https = require('https');
			const http = require('http');
			const parsed = new URL(url);
			const isHttps = parsed.protocol === 'https:';
			const reqFn = isHttps ? https.request : http.request;

			const options = {
				hostname: parsed.hostname,
				port: parsed.port || (isHttps ? 443 : 80),
				path: parsed.pathname + parsed.search,
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.apiKey}`,
					'x-api-key': this.apiKey,
					'anthropic-version': '2023-06-01',
					'Content-Length': Buffer.byteLength(body).toString(),
				},
			};

			const req = reqFn(options, (res: any) => {
				if (res.statusCode < 200 || res.statusCode >= 300) {
					let errBody = '';
					res.on('data', (chunk: Buffer) => { errBody += chunk.toString(); });
					res.on('end', () => {
						let msg: string;
						try { const j = JSON.parse(errBody); msg = j.error?.message || j.message || errBody; }
						catch { msg = errBody; }
						reject(new Error(`SenseNova API error (${res.statusCode}): ${msg}`));
					});
					return;
				}

				let buffer = '';
				const toolInputs = new Map<number, SenseNovaToolCall>();
				const toolArgs = new Map<number, string>();
				let done = false;

				res.on('data', (chunk: Buffer) => {
					if (cancellationToken?.isCancellationRequested) return;
					buffer += chunk.toString();
					const lines = buffer.split('\n');
					buffer = lines.pop() || '';
					for (const line of lines) {
						const trimmed = line.trim();
						if (!trimmed || trimmed.startsWith(':')) continue;
						if (!trimmed.startsWith('data: ')) continue;
						const jsonStr = trimmed.slice(6);
						if (jsonStr === '[DONE]') { if (!done) { done = true; callbacks.onDone(); } resolve(); return; }
						try {
							this.handleEvent(JSON.parse(jsonStr) as SenseNovaStreamEvent, callbacks, toolInputs, toolArgs);
						} catch { /* skip */ }
					}
				});
				res.on('end', () => { if (!done) { done = true; callbacks.onDone(); } resolve(); });
			});

			req.on('error', reject);
			if (cancellationToken) cancellationToken.onCancellationRequested(() => req.destroy());
			req.write(body);
			req.end();
		});
	}

	private handleEvent(
		event: SenseNovaStreamEvent,
		callbacks: StreamCallbacks,
		toolInputs: Map<number, SenseNovaToolCall>,
		toolArgs: Map<number, string>,
	): void {
		switch (event.type) {
			case 'message_start':
				if (event.message?.usage && callbacks.onUsage) callbacks.onUsage(event.message.usage);
				break;
			case 'content_block_start':
				if (event.content_block.type === 'tool_use') {
					toolInputs.set(event.index, { id: event.content_block.id, name: event.content_block.name, input: {} });
					toolArgs.set(event.index, '');
				}
				break;
			case 'content_block_delta': {
				const d = event.delta;
				if (d.type === 'text_delta') callbacks.onContent(d.text);
				else if (d.type === 'thinking_delta') callbacks.onThinking(d.thinking);
				else if (d.type === 'input_json_delta') toolArgs.set(event.index, (toolArgs.get(event.index) ?? '') + d.partial_json);
				break;
			}
			case 'content_block_stop': {
				const meta = toolInputs.get(event.index);
				const args = toolArgs.get(event.index);
				if (meta && args !== undefined) {
					let parsed: Record<string, unknown> = {};
					try { parsed = args ? JSON.parse(args) : {}; } catch { /* */ }
					callbacks.onToolCall({ id: meta.id, name: meta.name, input: parsed });
					toolInputs.delete(event.index);
					toolArgs.delete(event.index);
				}
				break;
			}
			case 'message_delta':
				if (event.usage && callbacks.onUsage) callbacks.onUsage({ input_tokens: 0, output_tokens: event.usage.output_tokens ?? 0 });
				break;
			case 'message_stop':
				break;
		}
	}
}
