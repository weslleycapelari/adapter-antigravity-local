import type { TranscriptEntry } from "@paperclipai/adapter-utils";

/**
 * Como o Antigravity CLI no modo `--print` retorna plain text,
 * não precisamos mais de parsers complexos de JSON stream.
 * Tudo que cai no stdout é mapeado como texto do assistente.
 */
export function parseAntigravityStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const text = line.trim();
  
  if (!text) {
    return [];
  }

  // Se no futuro o Antigravity introduzir prefixos de erro no stdout,
  // podemos interceptá-los aqui. Por enquanto, assumimos text = assistant.
  const lowerText = text.toLowerCase();
  if (lowerText.startsWith("error:") || lowerText.startsWith("fatal:")) {
    return [{ kind: "stderr", ts, text }];
  }

  return [{ kind: "assistant", ts, text }];
}