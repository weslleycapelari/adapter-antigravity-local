/**
 * @fileoverview Checkpoint streaming log wrapper that tracks token usage and cost accounting
 * during child process execution, notifying Paperclip onUsage hooks as progress occurs.
 *
 * @copyright Antigravity Adapter Contributors
 * @license MIT
 */

/**
 * Interface representing a stream logger augmented with a flush lifecycle hook.
 */
export interface UsageCheckpointLog {
  /**
   * Forwards a log chunk from either standard output or standard error.
   *
   * @param stream - The stream source ("stdout" or "stderr").
   * @param chunk - The raw text payload emitted by the process.
   */
  (stream: "stdout" | "stderr", chunk: string): Promise<void>;

  /**
   * Flushes any buffered stdout tokens and emits final usage accounting.
   */
  flush(): Promise<void>;
}

/**
 * Creates an execution logger that buffers stdout and dispatches incremental usage checkpoints.
 *
 * @template T - The structure of the extracted usage checkpoint object.
 * @param onLog - Optional delegate for forwarding stdout/stderr chunks.
 * @param onUsage - Optional delegate for receiving incremental usage metrics.
 * @param extract - Parser callback transforming stdout text into an accounting checkpoint.
 * @returns A callable logger function augmented with an async `flush` method.
 */
export function createUsageCheckpointLog<T>(
  onLog: ((stream: "stdout" | "stderr", chunk: string) => Promise<void> | void) | undefined,
  onUsage: ((checkpoint: T) => Promise<void> | void) | undefined,
  extract: (stdout: string) => T,
): UsageCheckpointLog {
  let stdoutBuffer = "";
  let lastCheckpointJson: string | null = null;

  const logFn = async (stream: "stdout" | "stderr", chunk: string): Promise<void> => {
    if (onLog) {
      await onLog(stream, chunk);
    }
    if (stream === "stdout") {
      stdoutBuffer += chunk;
      if (onUsage) {
        const checkpoint = extract(stdoutBuffer);
        const serialized = JSON.stringify(checkpoint);
        if (serialized !== lastCheckpointJson) {
          lastCheckpointJson = serialized;
          await onUsage(checkpoint);
        }
      }
    }
  };

  const flush = async (): Promise<void> => {
    if (onUsage && stdoutBuffer.length > 0) {
      const checkpoint = extract(stdoutBuffer);
      const serialized = JSON.stringify(checkpoint);
      if (serialized !== lastCheckpointJson) {
        lastCheckpointJson = serialized;
        await onUsage(checkpoint);
      }
    }
  };

  return Object.assign(logFn, { flush });
}
