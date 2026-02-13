import * as path from "path";
import type { ApiContext } from "./context";
import { AIService } from "../../services/aiService";
import type { AIStreamEvent } from "../../services/aiService";
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

    // POST /api/ai/start-ticket - Start with AI using Claude Agent SDK
    "/api/ai/start-ticket": {
      POST: handler(async (req: Request) => {
        const body = await req.json();
        const { ticketKey } = body;

        if (!ticketKey) {
          return errorResponse("Missing ticketKey", 400);
        }

        // Check if AI is enabled
        const isEnabled = await ctx.configService.isAIEnabled();
        if (!isEnabled) {
          return errorResponse("AI features are not enabled. Set ai.enabled: true in ~/.buddy.yaml", 400);
        }

        // Get selected repo
        const selectedRepo = ctx.cacheService.getSelectedRepo();
        if (!selectedRepo) {
          return errorResponse("No repository selected. Go to Git page to select a repository.", 400);
        }

        // Create a job to track the AI session
        const job = ctx.jobService.createJob({
          type: "ai-start",
          target: ticketKey,
        });

        // Get services for AI
        const { jiraService } = await ctx.getServices();
        const aiService = new AIService(ctx.configService, jiraService);

        // Start the job
        ctx.jobService.updateJobStatus(job.id, "running");

        // Create abort controller for cancellation
        const abortController = new AbortController();
        ctx.jobService.registerProcess(job.id, {
          kill: () => abortController.abort(),
        });

        // Run the AI start process asynchronously
        (async () => {
          try {
            await aiService.startWithAI({
              ticketKey,
              repoPath: selectedRepo.path,
              signal: abortController.signal,
              onEvent: (event: AIStreamEvent) => {
                // Serialize events as JSON lines in job output
                ctx.jobService.appendOutput(job.id, JSON.stringify(event));
              },
              onComplete: (sessionId: string) => {
                ctx.jobService.unregisterProcess(job.id);
                ctx.jobService.updateJobStatus(job.id, "completed");
              },
            });
          } catch (err) {
            ctx.jobService.appendOutput(job.id, JSON.stringify({
              type: "error",
              message: String(err),
            }));
            ctx.jobService.unregisterProcess(job.id);
            ctx.jobService.updateJobStatus(job.id, "failed", String(err));
          }
        })();

        return Response.json({ jobId: job.id });
      }),
    },

    // POST /api/ai/start-ticket-test - Test mode: start AI with manual ticket info (no JIRA needed)
    "/api/ai/start-ticket-test": {
      POST: handler(async (req: Request) => {
        const body = await req.json();
        const { ticketKey, summary, description } = body;

        if (!ticketKey) {
          return errorResponse("Missing ticketKey", 400);
        }

        // Get selected repo
        const selectedRepo = ctx.cacheService.getSelectedRepo();
        if (!selectedRepo) {
          return errorResponse("No repository selected. Go to Git page to select a repository.", 400);
        }

        // Create a job to track the AI session
        const job = ctx.jobService.createJob({
          type: "ai-start",
          target: ticketKey,
        });

        ctx.jobService.updateJobStatus(job.id, "running");

        const abortController = new AbortController();
        ctx.jobService.registerProcess(job.id, {
          kill: () => abortController.abort(),
        });

        const repoPath = selectedRepo.path;

        // Run the AI session asynchronously — manually build start.md, skip JIRA
        (async () => {
          const emit = (event: AIStreamEvent) => {
            ctx.jobService.appendOutput(job.id, JSON.stringify(event));
          };

          try {
            // Small delay to let the SSE connection establish before emitting events
            await new Promise((r) => setTimeout(r, 500));

            emit({ type: "status", message: `Test mode: using manual ticket info for ${ticketKey}` });

            // Create ticket directory
            const ticketDir = path.join(repoPath, ".claude", "tickets", ticketKey);
            await Bun.$`mkdir -p ${ticketDir}`.quiet();

            // Build start.md from manual input
            let md = `# ${ticketKey}: ${summary || ticketKey}\n\n`;
            md += `| Field | Value |\n|-------|-------|\n`;
            md += `| Type | Task |\n`;
            md += `| Status | To Do |\n`;
            md += `| Priority | Medium |\n\n`;

            if (description) {
              md += `## Description\n\n${description}\n\n`;
            }

            md += `## Clues\n\n_Add any hints, relevant file paths, or context that might help._\n`;

            const startMdPath = path.join(ticketDir, "start.md");
            await Bun.write(startMdPath, md);
            emit({ type: "file_created", filePath: `.claude/tickets/${ticketKey}/start.md` });
            emit({ type: "status", message: `Created .claude/tickets/${ticketKey}/start.md` });

            // Ensure the start-ticket command exists
            const commandDir = path.join(repoPath, ".claude", "commands");
            const commandPath = path.join(commandDir, "start-ticket.md");
            const commandExists = await Bun.file(commandPath).exists();
            if (!commandExists) {
              await Bun.$`mkdir -p ${commandDir}`.quiet();
              await Bun.write(commandPath, `Read the ticket start file at \`.claude/tickets/$ARGUMENTS/start.md\` to understand the ticket requirements.

Then follow this workflow:

1. **Explore the codebase** — Understand the architecture, patterns, and relevant code areas
2. **Create a plan** — Write your implementation plan to \`.claude/tickets/$ARGUMENTS/plan.md\`
3. **Begin implementation** — Start implementing the plan
4. **Track progress** — Update \`.claude/tickets/$ARGUMENTS/trace.md\` as you work

Important:
- Do NOT commit changes — leave them for review
- Follow any guidelines in CLAUDE.md if it exists
- Be thorough in your investigation before making changes
- Work autonomously — do not ask questions, make reasonable decisions
`);
              emit({ type: "file_created", filePath: `.claude/commands/start-ticket.md` });
            }

            emit({ type: "status", message: "Starting Claude Code SDK..." });

            const { query: claudeQuery } = await import("@anthropic-ai/claude-agent-sdk");

            // Strip CLAUDECODE env var to avoid "nested session" rejection
            const cleanEnv = { ...process.env };
            delete cleanEnv.CLAUDECODE;

            const q = claudeQuery({
              prompt: `/start-ticket ${ticketKey}`,
              options: {
                cwd: repoPath,
                permissionMode: "acceptEdits",
                model: "claude-opus-4-6",
                includePartialMessages: true,
                settingSources: ["project"],
                systemPrompt: { type: "preset", preset: "claude_code" },
                tools: { type: "preset", preset: "claude_code" },
                abortController,
                env: cleanEnv,
              },
            });

            console.log("[AI Test] query() returned, iterating messages...");

            let sessionId = "";

            // Track partial text for streaming deltas
            let currentText = "";

            for await (const message of q) {
              if (abortController.signal.aborted) break;

              switch (message.type) {
                case "system": {
                  if (message.subtype === "init") {
                    sessionId = message.session_id;
                    emit({ type: "session_id", sessionId });
                    emit({ type: "status", message: `Session started (model: ${(message as any).model})` });
                  }
                  break;
                }

                case "stream_event": {
                  // Live streaming events — this is where the conversation appears in real-time
                  const event = (message as any).event;
                  if (!event) break;

                  switch (event.type) {
                    case "content_block_start": {
                      const block = event.content_block;
                      if (block?.type === "text") {
                        currentText = "";
                      } else if (block?.type === "tool_use") {
                        emit({ type: "tool_use", toolName: block.name, toolInput: "" });
                      }
                      break;
                    }
                    case "content_block_delta": {
                      const delta = event.delta;
                      if (delta?.type === "text_delta" && delta.text) {
                        currentText += delta.text;
                        emit({ type: "assistant_text", text: delta.text });
                      } else if (delta?.type === "input_json_delta" && delta.partial_json) {
                        // Tool input streaming — skip to avoid noise
                      }
                      break;
                    }
                    case "content_block_stop": {
                      currentText = "";
                      break;
                    }
                  }
                  break;
                }

                case "assistant": {
                  // Full assistant message (after streaming completes) — emit tool uses with full input
                  if (message.message?.content) {
                    for (const block of message.message.content) {
                      if (block.type === "tool_use") {
                        const inputStr = typeof block.input === "string"
                          ? block.input
                          : JSON.stringify(block.input, null, 2);
                        emit({
                          type: "tool_use",
                          toolName: block.name,
                          toolInput: inputStr.length > 500 ? inputStr.slice(0, 500) + "..." : inputStr,
                        });
                      }
                    }
                  }
                  break;
                }

                case "tool_use_summary": {
                  emit({ type: "status", message: (message as any).summary });
                  break;
                }

                case "result": {
                  emit({
                    type: "result",
                    sessionId: (message as any).session_id,
                    costUsd: (message as any).total_cost_usd,
                    durationMs: (message as any).duration_ms,
                    numTurns: (message as any).num_turns,
                  });
                  break;
                }
              }
            }

            console.log("[AI Test] Loop finished, completing job");
            ctx.jobService.unregisterProcess(job.id);
            ctx.jobService.updateJobStatus(job.id, "completed");
          } catch (err: any) {
            if (err?.name === "AbortError" || abortController.signal.aborted) {
              emit({ type: "status", message: "Session cancelled" });
              ctx.jobService.unregisterProcess(job.id);
              ctx.jobService.updateJobStatus(job.id, "cancelled");
              return;
            }
            console.error("[AI Test] Error:", err?.message || err);
            emit({ type: "error", message: `Claude SDK error: ${err?.message || err}` });
            ctx.jobService.unregisterProcess(job.id);
            ctx.jobService.updateJobStatus(job.id, "failed", String(err));
          }
        })();

        return Response.json({ jobId: job.id });
      }),
    },

    // GET /api/ai/ticket-files/:ticketKey - Read ticket files (start.md, plan.md, trace.md)
    "/api/ai/ticket-files/:ticketKey": {
      GET: handler(async (req: Request & { params: { ticketKey: string } }) => {
        const { ticketKey } = req.params;

        const selectedRepo = ctx.cacheService.getSelectedRepo();
        if (!selectedRepo) {
          return errorResponse("No repository selected", 400);
        }

        const ticketDir = path.join(selectedRepo.path, ".claude", "tickets", ticketKey);

        const readFile = async (name: string): Promise<string | null> => {
          try {
            const file = Bun.file(path.join(ticketDir, name));
            if (await file.exists()) {
              return await file.text();
            }
          } catch {}
          return null;
        };

        const [startMd, planMd, traceMd] = await Promise.all([
          readFile("start.md"),
          readFile("plan.md"),
          readFile("trace.md"),
        ]);

        return Response.json({ startMd, planMd, traceMd });
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
