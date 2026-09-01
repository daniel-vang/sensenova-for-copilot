<h1 align="center">SenseNova for Copilot Chat</h1>

**Use SenseNova models in GitHub Copilot Chat — auto-discovers all available models from your account. Thinking mode, vision, agent tools — zero config, BYOK.**

## Features

### Auto Model Discovery
Queries `GET /v1/models` from your SenseNova account at runtime. **No hardcoding, no code changes, no releases needed.** When SenseNova adds or removes models, the plugin syncs automatically.

### Why this extension?

- **Don't replace Copilot — enhance it.** No new sidebar, no new chat UI. Just new models in the picker you already use.
- **Agent mode, tool calling, instructions, MCP, skills — all work.** Copilot's full stack, now running on SenseNova.
- **Prompt caching that actually works.** Reads `prompt_tokens_details.cached_tokens` from each response and feeds it back, keeping the server-side cache warm across turns.
- **Reasoning token tracking.** Every response logs reasoning token counts so you can see how much thinking the model invested.
- **Vision support.** Models with image input can analyze screenshots, UI mockups, and diagrams directly.
- **BYOK, pay SenseNova directly.** Your API key, your bill, your rate limits. Stored in the OS keychain.

### Inherits Every Copilot Capability
- **Agent mode** — autonomous multi-step tasks
- **Tool calling** — file edits, terminal, workspace search, Git, tests
- **Instructions & skills** — `.instructions.md`, `AGENTS.md`, skills all work

### Secure by Default
API key lives in VS Code's `SecretStorage` (OS keychain). Never in `settings.json`, never in Git history.

### Zero Runtime Dependencies
Pure VS Code API + Node.js built-ins. No Python, Docker, or local proxy server needed.

## Getting Started

### Prerequisites

- VS Code 1.116 or later
- GitHub Copilot subscription (Free / Pro / Enterprise)
- SenseNova Token Plan API key from [platform.sensenova.cn](https://platform.sensenova.cn)

### Usage

1. Install from VS Code Marketplace
2. Run **SenseNova: Set API Key** from Command Palette (`Ctrl+Shift+P`)
3. Paste your SenseNova Token Plan API key
4. Open Copilot Chat, pick a SenseNova model from the picker
5. Start chatting

## Settings

| Setting | Default | Description |
|---|---|---|
| `sensenova-copilot.maxTokens` | `0` | Max output tokens per request (`0` = API default) |
| `sensenova-copilot.modelIdOverrides` | `{}` | Override API model IDs (for third-party proxies) |

## Commands

| Command | Description |
|---|---|
| `SenseNova: Set API Key` | Configure your SenseNova API key |
| `SenseNova: Get API Key` | Open SenseNova platform to get an API key |
| `SenseNova: Clear API Key` | Remove the stored API key |
| `SenseNova: Open Settings` | Open plugin settings |
| `SenseNova: Show Logs` | View plugin logs for debugging |

## License

[MIT](LICENSE)
