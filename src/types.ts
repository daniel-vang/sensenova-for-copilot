/**
 * Shared types for the SenseNova Copilot extension.
 * Uses Anthropic Messages API format.
 */

// ---- Anthropic Messages API types ----

export type SenseNovaContentPart =
	| { type: 'text'; text: string }
	| {
			type: 'image';
			source: { type: 'base64'; media_type: string; data: string };
	  };

export interface SenseNovaMessage {
	role: 'user' | 'assistant';
	content: string | SenseNovaContentPart[];
}

export interface SenseNovaTool {
	name: string;
	description?: string;
	input_schema?: Record<string, unknown>;
}

export interface SenseNovaToolCall {
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface SenseNovaRequest {
	model: string;
	max_tokens: number;
	system?: string;
	messages: SenseNovaMessage[];
	stream: boolean;
	tools?: SenseNovaTool[];
	thinking?: { type: 'adaptive' | 'disabled' };
	temperature?: number;
	top_p?: number;
}

// ---- Anthropic SSE stream events ----

export type SenseNovaStreamEvent =
	| { type: 'message_start'; message: { usage?: SenseNovaUsage } }
	| { type: 'content_block_start'; index: number; content_block: { type: 'text'; text: string } | { type: 'thinking'; thinking: string } | { type: 'tool_use'; id: string; name: string } }
	| { type: 'content_block_delta'; index: number; delta: { type: 'text_delta'; text: string } | { type: 'thinking_delta'; thinking: string } | { type: 'input_json_delta'; partial_json: string } }
	| { type: 'content_block_stop'; index: number }
	| { type: 'message_delta'; delta: { stop_reason: string }; usage?: { output_tokens: number } }
	| { type: 'message_stop' }
	| { type: 'ping' };

// ---- Usage ----

export interface SenseNovaUsage {
	input_tokens: number;
	output_tokens: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
}

// ---- Stream callbacks ----

export interface StreamCallbacks {
	onContent: (content: string) => void;
	onThinking: (text: string) => void;
	onToolCall: (toolCall: SenseNovaToolCall) => void;
	onError: (error: Error) => void;
	onDone: () => void;
	onUsage?: (usage: SenseNovaUsage) => void;
}

// ---- Model definitions ----

export interface ModelDefinition {
	id: string;
	name: string;
	family: string;
	version: string;
	detail: string;
	maxInputTokens: number;
	maxOutputTokens: number;
	capabilities: {
		toolCalling: boolean;
		imageInput: boolean;
		thinking: boolean;
	};
	requiresThinkingParam: boolean;
}
