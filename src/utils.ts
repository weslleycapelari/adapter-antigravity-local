/**
 * Type guard that asserts whether an unknown value is a valid, non-empty string.
 * Automatically trims the value before performing the length check.
 * 
 * @param value - The unknown value to evaluate.
 * @returns True if the value is a populated string, false otherwise.
 * 
 * @example
 * ```typescript
 * if (isNonEmptyString(config.model)) {
 *   console.log("Selected model:", config.model.trim());
 * }
 * ```
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Splits a text block by line breaks (`\n` or `\r\n`), trims each individual line,
 * and filters out any completely empty lines.
 * 
 * @param text - The raw string containing one or more lines of text.
 * @returns A cleaned array of strings containing only populated lines.
 * 
 * @example
 * ```typescript
 * const lines = parseMultilineLines("  line 1  \n\n  line 2  ");
 * // Returns: ["line 1", "line 2"]
 * ```
 */
export function parseMultilineLines(text: string): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Safely retrieves the first populated (non-empty) line from a text block.
 * Utilizes `parseMultilineLines` internally to clean line breaks and whitespaces.
 * 
 * @param text - The text string to evaluate.
 * @returns The first cleaned line found, or an empty string if no valid content is present.
 * 
 * @example
 * ```typescript
 * const first = firstNonEmptyLine("\n\n   First Relevant Message  \n Second line ");
 * // Returns: "First Relevant Message"
 * ```
 */
export function firstNonEmptyLine(text: string): string {
  return parseMultilineLines(text)[0] ?? "";
}

/**
 * Splits a comma-separated arguments string into a structured array of clean,
 * non-empty strings. Extremely useful for processing form inputs and additional CLI arguments.
 * 
 * @param value - The raw comma-separated arguments string.
 * @returns An array containing the cleaned individual arguments.
 * 
 * @example
 * ```typescript
 * const args = parseCommaArgs(" --verbose ,   , --sandbox ");
 * // Returns: ["--verbose", "--sandbox"]
 * ```
 */
export function parseCommaArgs(value: string): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Validates in an OS-agnostic manner whether an executable command or PATH matches
 * the expected binary name. Handles Windows extensions (`.exe` and `.cmd`) automatically.
 * 
 * @param command - The command or full executable path to analyze (e.g., "/usr/bin/agy").
 * @param expected - The expected technical binary name (e.g., "agy").
 * @returns True if the command matches the expected binary name, ignoring case and Windows extensions.
 * 
 * @example
 * ```typescript
 * const matches = commandLooksLike("C:\\Program Files\\agy.exe", "agy");
 * // Returns: true
 * ```
 */
export function commandLooksLike(command: string, expected: string): boolean {
  if (!command) return false;
  const base = command.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const expectedLower = expected.toLowerCase();
  return base === expectedLower || base === `${expectedLower}.cmd` || base === `${expectedLower}.exe`;
}
