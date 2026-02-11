import type { JobStrategy, JobParams, JobContext } from "./types";

export class TailLogsJobStrategy implements JobStrategy {
  async execute(jobId: string, params: JobParams, ctx: JobContext): Promise<void> {
    const awsFunctionName = params.target;

    ctx.jobService.updateJobStatus(jobId, "running");
    ctx.jobService.appendOutput(jobId, `=== Tailing Logs: ${awsFunctionName} ===`);
    ctx.jobService.appendOutput(jobId, `Log group: /aws/lambda/${awsFunctionName}`);
    ctx.jobService.appendOutput(jobId, ``);
    ctx.jobService.appendOutput(jobId, `Waiting for new log events...`);
    ctx.jobService.appendOutput(jobId, ``);

    // Create an abort controller for cancellation
    const abortController = new AbortController();

    // Store the abort function so the job can be cancelled
    ctx.jobService.registerProcess(jobId, {
      kill: () => abortController.abort(),
    });

    try {
      let lastEventTimestamp = Date.now();
      const eventsPerBatch = 500; // Reconnect after this many events

      // Keep tailing until cancelled
      while (!abortController.signal.aborted) {
        // Start tailing logs from last event timestamp
        const logGenerator = ctx.infraService.tailLambdaLogs(awsFunctionName, {
          startTime: lastEventTimestamp,
          pollIntervalMs: 2000,
          signal: abortController.signal,
        });

        let eventCount = 0;

        for await (const event of logGenerator) {
          if (abortController.signal.aborted) break;

          // Format the log event
          const timestamp = new Date(event.timestamp).toLocaleTimeString();
          const message = event.message.trim();

          // Skip empty messages
          if (!message) continue;

          ctx.jobService.appendOutput(jobId, `[${timestamp}] ${message}`);
          eventCount++;

          // Track the latest event timestamp for reconnection
          // Add 1ms to avoid duplicate events on reconnect
          lastEventTimestamp = Math.max(lastEventTimestamp, event.timestamp + 1);

          // Check if we've hit the batch limit - reconnect to continue
          if (eventCount >= eventsPerBatch) {
            ctx.jobService.appendOutput(jobId, ``);
            ctx.jobService.appendOutput(
              jobId,
              `--- Reconnecting to continue streaming (${eventsPerBatch} events processed) ---`
            );
            ctx.jobService.appendOutput(jobId, ``);
            break;
          }
        }

        // If aborted, exit the outer loop
        if (abortController.signal.aborted) break;

        // If we didn't hit the batch limit, the generator ended naturally
        // This shouldn't normally happen with polling, but handle it gracefully
        if (eventCount < eventsPerBatch) {
          // Wait a bit and try again (generator might have errored internally)
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      ctx.jobService.unregisterProcess(jobId);

      ctx.jobService.appendOutput(jobId, ``);
      ctx.jobService.appendOutput(jobId, `--- Log tailing stopped ---`);
      ctx.jobService.updateJobStatus(jobId, "cancelled");
    } catch (error: any) {
      ctx.jobService.unregisterProcess(jobId);
      ctx.jobService.appendOutput(jobId, ``);
      ctx.jobService.appendOutput(jobId, `\u2717 Error: ${error.message || error}`);
      ctx.jobService.updateJobStatus(jobId, "failed", String(error));
    }
  }
}
