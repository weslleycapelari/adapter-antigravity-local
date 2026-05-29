import pc from "picocolors";

export function printAntigravityStreamEvent(raw: string, _debug: boolean): void {
  const line = raw.trim();
  if (!line) return;

  // Se for um erro explícito retornado no fluxo de texto
  if (line.toLowerCase().startsWith("error:") || line.toLowerCase().startsWith("fatal:")) {
    console.log(pc.red(line));
    return;
  }

  // Como é texto puro (plain text), apenas printamos em verde como resposta do assistente
  console.log(pc.green(line));
}