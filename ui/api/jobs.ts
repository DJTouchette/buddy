import type { JobType } from "../../services/jobService";
import { InfraService } from "../../services/infraService";
import { LambdaBuilderService } from "../../services/lambdaBuilderService";
import type { ApiContext } from "./context";
import { handler, errorResponse } from "./helpers";
import { isProtectedEnvironment } from "./infra";
import { executeJob } from "./jobs/executor";
import type { JobContext } from "./jobs/strategies/types";

export function jobsRoutes(ctx: ApiContext) {
  const infraService = new InfraService();
  const builderService = new LambdaBuilderService(ctx.jobService);

  const jobCtx: JobContext = {
    jobService: ctx.jobService,
    configService: ctx.configService,
    cacheService: ctx.cacheService,
    infraService,
    builderService,
  };

  return {
    "/api/jobs": {
      GET: handler(async (req: Request) => {
        const url = new URL(req.url);
        const activeOnly = url.searchParams.get("active") === "true";

        const jobs = activeOnly
          ? ctx.jobService.getActiveJobs()
          : ctx.jobService.getRecentJobs(30);

        return Response.json({ jobs });
      }),

      POST: handler(async (req: Request) => {
        const body = (await req.json()) as {
          type: JobType;
          target: string;
          skipBuild?: boolean;
          awsFunctionName?: string;
        };

        if (!body.type || !body.target) {
          return errorResponse("Missing type or target", 400);
        }

        const selectedRepo = ctx.cacheService.getSelectedRepo();
        if (!selectedRepo) {
          return errorResponse(
            "No repository selected. Go to Git page and select a repo first.",
            400
          );
        }

        const paths = infraService.getInfraPaths(selectedRepo.path);
        if (!paths) {
          return errorResponse(
            "Selected repository doesn't have infrastructure folder",
            400
          );
        }

        const job = ctx.jobService.createJob({
          type: body.type,
          target: body.target,
        });

        // Check for protected environment on deploy/deploy-lambda
        if (body.type === "deploy" || body.type === "deploy-lambda") {
          const currentEnv = await ctx.configService.getCurrentEnvironment();
          if (await isProtectedEnvironment(currentEnv, ctx.configService)) {
            ctx.jobService.updateJobStatus(
              job.id,
              "failed",
              `Cannot deploy to protected environment "${currentEnv}". Switch to a personal environment first.`
            );
            return Response.json({ job });
          }
        }

        // Additional validation for deploy-lambda
        if (body.type === "deploy-lambda" && !body.awsFunctionName) {
          ctx.jobService.updateJobStatus(job.id, "failed", "Missing AWS function name");
          return Response.json({ job });
        }

        // Execute the job asynchronously (fire-and-forget)
        executeJob(job.id, body.type, {
          target: body.target,
          backendPath: paths.backendPath,
          infraPath: paths.infraPath,
          awsFunctionName: body.awsFunctionName,
          skipBuild: body.skipBuild,
        }, jobCtx);

        return Response.json({ job });
      }),
    },

    "/api/jobs/:id": {
      GET: handler(async (req: Request & { params: { id: string } }) => {
        const job = ctx.jobService.getJob(req.params.id);
        if (!job) {
          return errorResponse("Job not found", 404);
        }
        return Response.json({ job });
      }),
    },

    // SSE streaming endpoint - stays here as HTTP handling
    "/api/jobs/:id/output": {
      GET: async (req: Request & { params: { id: string } }) => {
        const jobId = req.params.id;
        const job = ctx.jobService.getJob(jobId);

        if (!job) {
          return Response.json({ error: "Job not found" }, { status: 404 });
        }

        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();

            for (const line of job.output) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line })}\n\n`));
            }

            if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ done: true, status: job.status })}\n\n`)
              );
              controller.close();
              return;
            }

            const unsubscribe = ctx.jobService.subscribeToOutput(jobId, (line) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line })}\n\n`));
              } catch {
                // Stream might be closed
              }
            });

            const checkInterval = setInterval(() => {
              const currentJob = ctx.jobService.getJob(jobId);
              if (
                currentJob &&
                (currentJob.status === "completed" ||
                  currentJob.status === "failed" ||
                  currentJob.status === "cancelled")
              ) {
                clearInterval(checkInterval);
                unsubscribe();
                try {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ done: true, status: currentJob.status })}\n\n`
                    )
                  );
                  controller.close();
                } catch {
                  // Stream might already be closed
                }
              }
            }, 500);

            req.signal?.addEventListener("abort", () => {
              clearInterval(checkInterval);
              unsubscribe();
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
      },
    },

    "/api/jobs/:id/cancel": {
      POST: handler(async (req: Request & { params: { id: string } }) => {
        const success = ctx.jobService.cancelJob(req.params.id);
        if (!success) {
          return errorResponse("Cannot cancel job (not running or not found)", 400);
        }
        return Response.json({ success: true });
      }),
    },

    "/api/jobs/:id/respond": {
      POST: handler(async (req: Request & { params: { id: string } }) => {
        const body = (await req.json()) as { approved: boolean };
        const jobId = req.params.id;

        const job = ctx.jobService.getJob(jobId);
        if (!job) {
          return errorResponse("Job not found", 404);
        }

        if (job.status !== "awaiting_approval") {
          return errorResponse("Job is not awaiting approval", 400);
        }

        const success = ctx.jobService.sendApprovalResponse(jobId, body.approved);
        if (!success) {
          return errorResponse("Failed to send response to job");
        }

        return Response.json({ success: true, approved: body.approved });
      }),
    },

    "/api/jobs/:id/diff": {
      GET: handler(async (req: Request & { params: { id: string } }) => {
        const jobId = req.params.id;
        const job = ctx.jobService.getJob(jobId);

        if (!job) {
          return errorResponse("Job not found", 404);
        }

        const diffOutput = ctx.jobService.getDiffOutput(jobId);

        return Response.json({
          diffOutput: diffOutput || job.output,
          status: job.status,
          target: job.target,
        });
      }),
    },

    "/api/jobs/builds": {
      GET: handler(async () => {
        const buildInfo = ctx.jobService.getAllLambdaBuildInfo();
        const builds: Record<string, {
          lastBuiltAt: number | null;
          lastBuildStatus: string | null;
          deploymentZipExists: boolean;
        }> = {};

        buildInfo.forEach((info, name) => {
          builds[name] = info;
        });

        return Response.json({ builds });
      }),
    },

    "/api/jobs/clear": {
      POST: handler(async () => {
        ctx.jobService.forceKillAll();
        return Response.json({ success: true, message: "All jobs cleared and processes killed" });
      }),
    },

    "/api/logs/:lambdaName": {
      GET: handler(async (req: Request) => {
        const lambdaName = decodeURIComponent(req.params.lambdaName);
        const logs = ctx.jobService.getSavedLogs(lambdaName);
        return Response.json({ logs });
      }),
    },

    "/api/logs": {
      POST: handler(async (req: Request) => {
        const body = (await req.json()) as {
          lambdaName: string;
          name: string;
          content: string;
        };

        if (!body.lambdaName || !body.name || !body.content) {
          return errorResponse("Missing lambdaName, name, or content", 400);
        }

        const log = ctx.jobService.saveLog(body.lambdaName, body.name, body.content);
        return Response.json({ log });
      }),
    },

    "/api/logs/view/:id": {
      GET: handler(async (req: Request) => {
        const log = ctx.jobService.getSavedLog(req.params.id);
        if (!log) {
          return errorResponse("Log not found", 404);
        }
        return Response.json({ log });
      }),
    },

    "/api/logs/delete/:id": {
      POST: handler(async (req: Request) => {
        const success = ctx.jobService.deleteSavedLog(req.params.id);
        if (!success) {
          return errorResponse("Log not found", 404);
        }
        return Response.json({ success: true });
      }),
    },
  };
}
