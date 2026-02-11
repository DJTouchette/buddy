import type { ApiContext } from "./context";
import { AIService } from "../../services/aiService";
import { RepoService } from "../../services/repoService";
import { handler, errorResponse } from "./helpers";

export function aiRoutes(ctx: ApiContext) {
  return {
    // GET /api/ai/config - Get AI configuration status
    "/api/ai/config": {
      GET: handler(async () => {
        const aiConfig = await ctx.configService.getAIConfig();
        const isEnabled = await ctx.configService.isAIEnabled();

        // Check if Claude CLI is available
        let claudeAvailable = false;
        const claudePath = await ctx.configService.getClaudePath();
        try {
          const proc = Bun.spawn([claudePath, "--version"], {
            stdout: "pipe",
            stderr: "pipe",
          });
          await proc.exited;
          claudeAvailable = proc.exitCode === 0;
        } catch {}

        return Response.json({
          enabled: isEnabled,
          claudePath,
          claudeAvailable,
        });
      }),

      PUT: handler(async (req: Request) => {
        const body = await req.json();
        await ctx.configService.setAIConfig(body);
        return Response.json({ success: true });
      }),
    },

    // POST /api/ai/fix-ticket - Start an AI fix job for a ticket
    "/api/ai/fix-ticket": {
      POST: handler(async (req: Request) => {
        const body = await req.json();
        const { ticketKey, ticketTitle, repoPath, baseBranch, existingBranch, mode = "file-only" } = body;

        if (!ticketKey) {
          return errorResponse("Missing ticketKey", 400);
        }

        if (!repoPath) {
          return errorResponse("Missing repoPath", 400);
        }

        if (!baseBranch && !existingBranch) {
          return errorResponse("Missing baseBranch or existingBranch", 400);
        }

        // Check if AI is enabled
        const isEnabled = await ctx.configService.isAIEnabled();
        if (!isEnabled) {
          return errorResponse("AI features are not enabled. Set ai.enabled: true in ~/.buddy.yaml", 400);
        }

        // Create a job to track the AI fix
        const job = ctx.jobService.createJob({
          type: "ai-fix",
          target: ticketKey,
        });

        // Get services for AI
        const { jiraService } = await ctx.getServices();

        // Create services
        const aiService = new AIService(ctx.configService, jiraService);
        const repoService = new RepoService();

        // Start the AI fix in the background
        ctx.jobService.updateJobStatus(job.id, "running");

        // Create abort controller for cancellation
        const abortController = new AbortController();
        ctx.jobService.registerProcess(job.id, {
          kill: () => abortController.abort(),
        });

        // Run the AI fix process asynchronously
        (async () => {
          try {
            // Step 1: Checkout/create the branch
            if (existingBranch) {
              ctx.jobService.appendOutput(job.id, `Checking out existing branch: ${existingBranch}`);
              ctx.jobService.appendOutput(job.id, "Fetching latest changes...");

              const fetchResult = await repoService.fetch(repoPath);
              if (!fetchResult.success) {
                throw new Error(`Failed to fetch: ${fetchResult.error}`);
              }

              const checkoutResult = await repoService.checkout(repoPath, existingBranch);
              if (!checkoutResult.success) {
                throw new Error(`Failed to checkout: ${checkoutResult.error}`);
              }

              ctx.jobService.appendOutput(job.id, "Pulling latest changes...");
              const pullResult = await repoService.pull(repoPath);
              if (!pullResult.success) {
                ctx.jobService.appendOutput(job.id, `[WARN] Pull failed (may be OK if branch is new): ${pullResult.error}`);
              }

              ctx.jobService.appendOutput(job.id, `✓ Checked out ${existingBranch}\n`);
            } else {
              ctx.jobService.appendOutput(job.id, `Creating new branch from ${baseBranch}...`);

              const branchResult = await repoService.checkoutTicket(
                repoPath,
                ticketKey,
                ticketTitle || ticketKey,
                baseBranch
              );

              if (!branchResult.success) {
                throw new Error(`Failed to create branch: ${branchResult.error}`);
              }

              ctx.jobService.appendOutput(job.id, `✓ Created and checked out ${branchResult.branchName}\n`);
            }

            // Step 2: Run AI fix
            await aiService.fixTicket({
              ticketKey,
              repoPath,
              mode: mode as "file-only" | "interactive",
              signal: abortController.signal,
              onOutput: (line) => {
                ctx.jobService.appendOutput(job.id, line);
              },
              onError: (line) => {
                ctx.jobService.appendOutput(job.id, `[ERROR] ${line}`);
              },
              onComplete: (success, error) => {
                ctx.jobService.unregisterProcess(job.id);
                if (success) {
                  ctx.jobService.updateJobStatus(job.id, "completed");
                } else {
                  ctx.jobService.updateJobStatus(job.id, "failed", error);
                }
              },
            });
          } catch (err) {
            ctx.jobService.appendOutput(job.id, `[ERROR] ${err}`);
            ctx.jobService.unregisterProcess(job.id);
            ctx.jobService.updateJobStatus(job.id, "failed", String(err));
          }
        })();

        return Response.json({ jobId: job.id });
      }),
    },

    // GET /api/ai/fix-ticket/:jobId/stream - Stream AI fix output
    "/api/ai/fix-ticket/:jobId/stream": {
      GET: handler(async (req: Request) => {
        const url = new URL(req.url);
        const jobId = url.pathname.split("/").slice(-2)[0];

        const job = ctx.jobService.getJob(jobId);
        if (!job) {
          return errorResponse("Job not found", 404);
        }

        const stream = new ReadableStream({
          start(controller) {
            // Send existing output first
            for (const line of job.output) {
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify({ type: "output", line })}\n\n`)
              );
            }

            // Send current status
            controller.enqueue(
              new TextEncoder().encode(
                `data: ${JSON.stringify({ type: "status", status: job.status })}\n\n`
              )
            );

            // If job is already done, close the stream
            if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
              controller.enqueue(
                new TextEncoder().encode(
                  `data: ${JSON.stringify({ type: "done", status: job.status, error: job.error })}\n\n`
                )
              );
              controller.close();
              return;
            }

            // Subscribe to live output
            const unsubscribe = ctx.jobService.subscribeToOutput(jobId, (line) => {
              try {
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify({ type: "output", line })}\n\n`)
                );
              } catch {
                // Stream might be closed
              }
            });

            // Poll for status changes
            const statusInterval = setInterval(() => {
              const currentJob = ctx.jobService.getJob(jobId);
              if (!currentJob) {
                clearInterval(statusInterval);
                unsubscribe();
                controller.close();
                return;
              }

              if (
                currentJob.status === "completed" ||
                currentJob.status === "failed" ||
                currentJob.status === "cancelled"
              ) {
                try {
                  controller.enqueue(
                    new TextEncoder().encode(
                      `data: ${JSON.stringify({
                        type: "done",
                        status: currentJob.status,
                        error: currentJob.error,
                      })}\n\n`
                    )
                  );
                } catch {}
                clearInterval(statusInterval);
                unsubscribe();
                controller.close();
              }
            }, 1000);

            // Cleanup on abort
            req.signal?.addEventListener("abort", () => {
              clearInterval(statusInterval);
              unsubscribe();
              try {
                controller.close();
              } catch {}
            });
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }),
    },
  };
}
