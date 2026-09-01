/**
 * Compile-time constants shared across the extension.
 *
 * These do NOT depend on the VS Code runtime (no workspace configuration,
 * no secrets API). For run-time settings reads see `config.ts`.
 */

/** VS Code configuration section prefix for all extension settings. */
export const CONFIG_SECTION = 'sensenova-copilot';

// ---- Secret keys ----

/** SecretStorage key for the SenseNova API key. */
export const API_KEY_SECRET = 'sensenova-copilot.apiKey';

/** memento key tracking whether the welcome walkthrough has been shown. */
export const WELCOME_SHOWN_KEY = 'sensenova-copilot.welcomeShown';

// ---- Walkthrough ----

/** Walkthrough contribution ID. */
export const WALKTHROUGH_ID = 'danielwang.sensenova-for-copilot#sensenovaGettingStarted';

// ---- Model picker ----

/** Detail text shown in the model picker when no API key is configured. */
export const API_KEY_REQUIRED_DETAIL = 'Please run SenseNova: Set API Key to configure.';

// ---- Cache ----

/** Max entries in the reasoning-content cache before eviction kicks in. */
export const MAX_CACHE_SIZE = 200;

// ---- API ----

/** Default SenseNova API base URL. */
export const DEFAULT_BASE_URL = 'https://token.sensenova.cn/v1';

/** Platform URL for API key management. */
export const PLATFORM_URL = 'https://platform.sensenova.cn';
