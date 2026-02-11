import type { JobService } from "../../../services/jobService";

/**
 * Strip ANSI escape codes from a string.
 * Handles color codes, cursor movement, line clearing, etc.
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(
    /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[PX^_][^\x1b]*\x1b\\|\x1b[@-Z\\-_]|\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g,
    ""
  );
}

/**
 * Stream process output line by line, stripping ANSI codes.
 * Reads both stdout and stderr, appending to job output.
 * Returns the exit code and optionally collected output lines.
 */
export async function streamProcessOutput(
  proc: {
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
  },
  jobId: string,
  jobService: JobService,
  opts?: {
    onLine?: (line: string) => void;
    collectOutput?: boolean;
  }
): Promise<{ exitCode: number; output: string[] }> {
  const collectedOutput: string[] = [];

  const streamSide = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const rawLine of lines) {
        const line = stripAnsi(rawLine);
        if (line.trim()) {
          jobService.appendOutput(jobId, line);
          opts?.onLine?.(line);
          if (opts?.collectOutput) collectedOutput.push(line);
        }
      }
    }

    if (buffer.trim()) {
      const line = stripAnsi(buffer);
      jobService.appendOutput(jobId, line);
      opts?.onLine?.(line);
      if (opts?.collectOutput) collectedOutput.push(line);
    }
  };

  await Promise.all([streamSide(proc.stdout), streamSide(proc.stderr)]);
  const exitCode = await proc.exited;
  return { exitCode, output: collectedOutput };
}
