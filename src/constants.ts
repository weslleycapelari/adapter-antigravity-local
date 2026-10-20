/**
 * @fileoverview Centralized constants and model identifiers for the Antigravity local CLI adapter.
 * Defines default model profiles, family fallbacks, and backwards-compatibility aliases.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

/** The default baseline Antigravity local model. */
export const DEFAULT_ANTIGRAVITY_LOCAL_MODEL = "gemini-3.8-flash-high";

/** Leadership role primary model (Gemini 4 Argon). */
export const DEFAULT_LEADERSHIP_ARGON_MODEL = "gemini-4-argon-high";

/** Leadership role fallback model when Argon reaches quota or is in cooldown. */
export const DEFAULT_LEADERSHIP_GEMINI_FALLBACK_MODEL = "gemini-3.8-flash-high";

/** Worker role primary model (Gemini 3.8 Flash). */
export const DEFAULT_WORKER_GEMINI_MODEL = "gemini-3.8-flash-high";

/** Worker role fallback model when Gemini reaches quota or is in cooldown. */
export const DEFAULT_WORKER_GPT_FALLBACK_MODEL = "gpt-oss-120b-medium";

/**
 * Deprecated worker Claude model alias kept for backwards compatibility.
 * @deprecated Use DEFAULT_WORKER_GPT_FALLBACK_MODEL instead.
 */
export const DEFAULT_WORKER_CLAUDE_MODEL = DEFAULT_WORKER_GPT_FALLBACK_MODEL;

/**
 * Deprecated leadership Claude fallback alias kept for backwards compatibility.
 * @deprecated Use DEFAULT_LEADERSHIP_GEMINI_FALLBACK_MODEL instead.
 */
export const DEFAULT_LEADERSHIP_CLAUDE_FALLBACK_MODEL = DEFAULT_LEADERSHIP_GEMINI_FALLBACK_MODEL;
