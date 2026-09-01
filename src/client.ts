import type { CancellationToken } from 'vscode';
import { logger } from './logger';
import type {
	SenseNovaRequest,
	SenseNovaStreamEvent,
	SenseNovaToolCall,
	StreamCallbacks,
} from './types';

/** Maximum number of retry attempts for transient failures. */
const MAX_RETRIES = 3;

/** Base delay for exponential backoff, in milliseconds. */
const BASE_BACKOFF_MS = 1000;

/** Upper bound for a single backoff delay, in milliseconds. */
const MAX_BACKOFF_MS = 15000;

/** Random jitter added to each delay to avoid retry storms, in milliseconds. */
const MAX_JITTER_MS = 250;

/**
 * Error carrying enough context for the caller to decide whether replaying
 * the request is worthwhile.
 */
class SenseNovaApiError extends Error {
	constructor(
		message: string,
		readonly statusCode: number | undefined,
		readonly retryable: boolean,
		readonly retryAfterMs: number | undefined = undefined,
	) {
		super(message);
		this.name = 'SenseNovaApiError';
	}
}

const EMPTY_RESPONSE_MESSAGE =
	'SenseNova returned an empty response (HTTP 200 with no data). ' +
	'This usually happens when the request rate limit is hit. ' +
	'Wait a moment and try again, or reduce how often requests are sent.';

/** Read a `Retry-After` header, which may be either seconds or an HTTP date. */
function parseRetryAfterMs(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);
	const date = Date.parse(value);
	if (!Number.isNaN(date)) {
		const delta = date - Date.now();
		if (delta >= 0) return Math.min(delta, MAX_BACKOFF_MS);
	}
	return undefined;
}

/** Pull the most useful message out of an Anthropic- or OpenAI-shaped error body. */
function extractErrorMessage(rawBody: string): string {
	if (!rawBody.trim()) return 'empty error body';
	try {
		const j = JSON.parse(rawBody);
		return j.error?.message ?? j.message ?? rawBody;
	} catch {
		return rawBody;
	}
}

function buildApiErrorMessage(statusCode: number, detail: string): string {
	if (statusCode === 429) {
		return (
			`SenseNova rate limit reached (429): ${detail}. ` +
			'Too many requests were sent too quickly. Wait a moment and try again, ' +
			'or raise the requests-per-minute (RPM) limit on your plan.'
		);
	}
	if (statusCode >= 500) {
		return (
			`SenseNova server error (${statusCode}): ${detail}. ` +
			'The request can be retried; if it keeps failing the service may be unavailable.'
		);
	}
	return `SenseNova API error (${statusCode}): ${detail}`;
}

function backoffDelayMs(attempt: number, retryAfterMs: number | undefined): number {
	const exponential = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
	const base = Math.min(retryAfterMs ?? exponential, MAX_BACKOFF_MS);
	return base + Math.random() * MAX_JITTER_MS;
}

function sleep(ms: number, token?: CancellationToken): Promise<void> {
	return new Promise<void>((resolve) => {
		if (token?.isCancellationRequested) {
			resolve();
			return;
		}
		const timer = setTimeout(resolve, ms);
		token?.onCancellationRequested(() => {
			clearTimeout(timer);
			resolve();
		});
	});
}

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
		const url = `${this.baseUrl}/messages`;
		const body = JSON.stringify(request);
		let lastError: unknown;

		for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
			if (cancellationToken?.isCancellationRequested) {
				callbacks.onDone();
				return;
			}

			try {
				await this.doPost(url, body, callbacks, cancellationToken);
				return;
			} catch (error) {
				lastError = error;

				// A cancelled request is not a failure worth reporting.
				if (cancellationToken?.isCancellationRequested) {
					callbacks.onDone();
					return;
				}

				const retryable = error instanceof SenseNovaApiError && error.retryable;
				if (!retryable || attempt === MAX_RETRIES) break;

				const delayMs = backoffDelayMs(attempt, (error as SenseNovaApiError).retryAfterMs);
				logger.warn(
					`Request failed (${(error as SenseNovaApiError).statusCode ?? 'empty response'}), ` +
						`retrying in ${Math.round(delayMs)}ms (attempt ${attempt + 1}/${MAX_RETRIES}): ${(error as Error).message}`,
				);
				await sleep(delayMs, cancellationToken);
			}
		}

		if (cancellationToken?.isCancellationRequested) {
			callbacks.onDone();
			return;
		}

		callbacks.onError(lastError instanceof Error ? lastError : new Error(String(lastError)));
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

			// Each retry builds a new request, so the cancellation listener
			// registered below is released as soon as this attempt settles.
			let settled = false;
			let cancelListener: { dispose(): void } | undefined;
			const settle = (action: () => void): void => {
				if (settled) return;
				settled = true;
				cancelListener?.dispose();
				action();
			};
			const settleOk = (): void => settle(() => resolve());
			const settleErr = (error: unknown): void => settle(() => reject(error));

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

			// Tracks whether anything reached the caller, so a response that only
			// ever sent keep-alive events can be told apart from a real answer.
			let deliveredAnyOutput = false;

			const req = reqFn(options, (res: any) => {
				if (res.statusCode < 200 || res.statusCode >= 300) {
					let errBody = '';
					res.on('data', (chunk: Buffer) => { errBody += chunk.toString(); });
					res.on('end', () => {
						const statusCode: number = res.statusCode;
						const detail = extractErrorMessage(errBody);
						const retryable = statusCode === 429 || statusCode >= 500;
						settleErr(new SenseNovaApiError(
							buildApiErrorMessage(statusCode, detail),
							statusCode,
							retryable,
							parseRetryAfterMs(res.headers?.['retry-after']),
						));
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
						if (jsonStr === '[DONE]') { if (!done) { done = true; callbacks.onDone(); } settleOk(); return; }
						try {
							const event = JSON.parse(jsonStr) as SenseNovaStreamEvent;
							if (this.handleEvent(event, callbacks, toolInputs, toolArgs)) {
								deliveredAnyOutput = true;
							}
						} catch { /* skip */ }
					}
				});

				res.on('end', () => {
					if (done) { settleOk(); return; }
					done = true;

					// The gateway sometimes answers an overloaded request with an
					// HTTP 200 that carries no data at all, or only keep-alive
					// events. Treat that as a transient failure rather than a
					// successful empty answer.
					if (!deliveredAnyOutput && !cancellationToken?.isCancellationRequested) {
						settleErr(new SenseNovaApiError(EMPTY_RESPONSE_MESSAGE, 200, true));
						return;
					}

					callbacks.onDone();
					settleOk();
				});
			});

			req.on('error', (err: Error) => {
				// A cancelled request is not a failure worth reporting.
				if (cancellationToken?.isCancellationRequested) {
					settleErr(err);
					return;
				}

				// Replaying the request would duplicate what the caller already
				// received, so this cannot be retried — but a raw transport
				// message such as "socket hang up" tells the user nothing.
				if (deliveredAnyOutput) {
					settleErr(new SenseNovaApiError(
						`Connection to SenseNova was lost after partial output: ${err.message}. ` +
						'The response is incomplete — try again.',
						undefined,
						false,
					));
					return;
				}

				settleErr(new SenseNovaApiError(
					`SenseNova network error: ${err.message}. No response was received.`,
					undefined,
					true,
				));
			});

			if (cancellationToken) {
				cancelListener = cancellationToken.onCancellationRequested(() => req.destroy());
			}
			req.write(body);
			req.end();
		});
	}

	/**
	 * Applies one SSE event and reports whether it produced output that was
	 * already handed to the caller — which is what makes replaying the request
	 * unsafe. Keep-alive `ping` and `message_stop` events deliver nothing, so a
	 * stream that only ever sent those can still be retried.
	 */
	private handleEvent(
		event: SenseNovaStreamEvent,
		callbacks: StreamCallbacks,
		toolInputs: Map<number, SenseNovaToolCall>,
		toolArgs: Map<number, string>,
	): boolean {
		switch (event.type) {
			case 'message_start':
				if (event.message?.usage && callbacks.onUsage) {
					callbacks.onUsage(event.message.usage);
					return true;
				}
				return false;
			case 'content_block_start':
				if (event.content_block.type === 'tool_use') {
					toolInputs.set(event.index, { id: event.content_block.id, name: event.content_block.name, input: {} });
					toolArgs.set(event.index, '');
				}
				return false;
			case 'content_block_delta': {
				const d = event.delta;
				if (d.type === 'text_delta') {
					callbacks.onContent(d.text);
					return true;
				}
				if (d.type === 'thinking_delta') {
					callbacks.onThinking(d.thinking);
					return true;
				}
				if (d.type === 'input_json_delta') {
					toolArgs.set(event.index, (toolArgs.get(event.index) ?? '') + d.partial_json);
				}
				return false;
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
					return true;
				}
				return false;
			}
			case 'message_delta':
				if (event.usage && callbacks.onUsage) {
					callbacks.onUsage({ input_tokens: 0, output_tokens: event.usage.output_tokens ?? 0 });
					return true;
				}
				return false;
			default:
				// `message_stop` and keep-alive `ping` events produce no output.
				return false;
		}
	}
}
