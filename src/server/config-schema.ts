/**
 * @fileoverview Configuration schema generator defining UI form fields and defaults for Paperclip console.
 * Exposes options for binary path, auto-approvals, reasoning effort, and account pooling slots.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

import type { AdapterConfigSchema } from "@paperclipai/adapter-utils";

/**
 * Returns the declarative configuration schema for the Antigravity Local adapter.
 * Used by Paperclip web UI to render agent configuration forms.
 *
 * @returns AdapterConfigSchema describing configuration fields.
 */
export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "command",
        label: "Antigravity CLI command",
        type: "text",
        default: "agy",
        hint: "Path or command name for the Antigravity CLI executable (defaults to agy).",
      },
      {
        key: "dangerouslySkipPermissions",
        label: "Auto-approve tool permissions",
        type: "toggle",
        default: true,
        hint: "Passes --dangerously-skip-permissions to allow autonomous execution without terminal prompts.",
      },
      {
        key: "effort",
        label: "Reasoning effort",
        type: "select",
        default: "",
        options: [
          { value: "", label: "Default" },
          { value: "low", label: "Low" },
          { value: "medium", label: "Medium" },
          { value: "high", label: "High" },
          { value: "xhigh", label: "Extra High" },
          { value: "max", label: "Max" },
        ],
        hint: "Controls model reasoning effort passed via --effort.",
      },
      {
        key: "accountProfile",
        label: "Account profile / pool slot",
        type: "text",
        hint: "Account identifier for rotation (e.g., account-1, account-2, account-3). Isolates token and quota.",
      },
    ],
  };
}
