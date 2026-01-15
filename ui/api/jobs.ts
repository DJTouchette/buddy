import { JobService, type JobType } from "../../services/jobService";
import { InfraService } from "../../services/infraService";
import { LambdaBuilderService } from "../../services/lambdaBuilderService";
import type { CacheService } from "../../services/cacheService";
import type { ConfigService } from "../../services/configService";
import { isProtectedEnvironment } from "./infra";

export interface JobsApiContext {
  cacheService: CacheService;
  jobService: JobService;
  configService: ConfigService;
}

export function jobsRoutes(ctx: JobsApiContext) {
  const infraService = new InfraService();
  const builderService = new LambdaBuilderService(ctx.jobService);

  return {
    // GET /api/jobs - List all jobs
    "/api/jobs": {
      GET: async (req: Request) => {
        try {
          const url = new URL(req.url);
          const activeOnly = url.searchParams.get("active") === "true";

          const jobs = activeOnly
            ? ctx.jobService.getActiveJobs()
            : ctx.jobService.getRecentJobs(30);

          return Response.json({ jobs });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },

      // POST /api/jobs - Create a new job
      POST: async (req: Request) => {
        try {
          const body = (await req.json()) as {
            type: JobType;
            target: string;
            skipBuild?: boolean;
            awsFunctionName?: string; // For deploy-lambda jobs
          };

          if (!body.type || !body.target) {
            return Response.json({ error: "Missing type or target" }, { status: 400 });
          }

          // Validate target based on type
          const selectedRepo = ctx.cacheService.getSelectedRepo();
          if (!selectedRepo) {
            return Response.json({
              error: "No repository selected. Go to Git page and select a repo first.",
            }, { status: 400 });
          }

          const paths = infraService.getInfraPaths(selectedRepo.path);
          if (!paths) {
            return Response.json({
              error: "Selected repository doesn't have infrastructure folder",
            }, { status: 400 });
          }

          // Create the job
          const job = ctx.jobService.createJob({
            type: body.type,
            target: body.target,
          });

          // Execute the job asynchronously
          if (body.type === "build") {
            executeBuildJob(job.id, body.target, paths.backendPath, ctx, infraService, builderService);
          } else if (body.type === "deploy") {
            // Check for protected environment on CDK deploy
            const currentEnv = await ctx.configService.getCurrentEnvironment();
            if (await isProtectedEnvironment(currentEnv, ctx.configService)) {
              ctx.jobService.updateJobStatus(
                job.id,
                "failed",
                `Cannot deploy to protected environment "${currentEnv}". Switch to a personal environment first.`
              );
            } else {
              executeCdkJob(job.id, body.type, body.target, paths.infraPath, ctx);
            }
          } else if (body.type === "diff" || body.type === "synth") {
            executeCdkJob(job.id, body.type, body.target, paths.infraPath, ctx);
          } else if (body.type === "deploy-lambda") {
            // Check for protected environment
            const currentEnv = await ctx.configService.getCurrentEnvironment();
            if (await isProtectedEnvironment(currentEnv, ctx.configService)) {
              ctx.jobService.updateJobStatus(
                job.id,
                "failed",
                `Cannot deploy to protected environment "${currentEnv}". Switch to a personal environment first.`
              );
            } else if (!body.awsFunctionName) {
              ctx.jobService.updateJobStatus(job.id, "failed", "Missing AWS function name");
            } else {
              executeDeployLambdaJob(
                job.id,
                body.target, // local handler name
                body.awsFunctionName,
                paths.backendPath,
                ctx,
                infraService,
                builderService
              );
            }
          } else if (body.type === "tail-logs") {
            // body.target is the AWS function name for tail-logs
            executeTailLogsJob(job.id, body.target, ctx, infraService);
          }

          return Response.json({ job });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/jobs/:id - Get job by ID
    "/api/jobs/:id": {
      GET: async (req: Request & { params: { id: string } }) => {
        try {
          const job = ctx.jobService.getJob(req.params.id);

          if (!job) {
            return Response.json({ error: "Job not found" }, { status: 404 });
          }

          return Response.json({ job });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/jobs/:id/output - Stream job output via SSE
    "/api/jobs/:id/output": {
      GET: async (req: Request & { params: { id: string } }) => {
        const jobId = req.params.id;
        const job = ctx.jobService.getJob(jobId);

        if (!job) {
          return Response.json({ error: "Job not found" }, { status: 404 });
        }

        // Create SSE stream
        const stream = new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();

            // Send existing output first
            for (const line of job.output) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line })}\n\n`));
            }

            // If job is already complete, close the stream
            if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ done: true, status: job.status })}\n\n`)
              );
              controller.close();
              return;
            }

            // Subscribe to new output
            const unsubscribe = ctx.jobService.subscribeToOutput(jobId, (line) => {
              try {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ line })}\n\n`));
              } catch {
                // Stream might be closed
              }
            });

            // Check periodically if job is done
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

            // Cleanup on abort
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

    // POST /api/jobs/:id/cancel - Cancel a running job
    "/api/jobs/:id/cancel": {
      POST: async (req: Request & { params: { id: string } }) => {
        try {
          const success = ctx.jobService.cancelJob(req.params.id);

          if (!success) {
            return Response.json({ error: "Cannot cancel job (not running or not found)" }, { status: 400 });
          }

          return Response.json({ success: true });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/jobs/builds - Get lambda build status
    "/api/jobs/builds": {
      GET: async () => {
        try {
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
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // POST /api/jobs/clear - Force clear all jobs and kill processes
    "/api/jobs/clear": {
      POST: async () => {
        try {
          ctx.jobService.forceKillAll();
          return Response.json({ success: true, message: "All jobs cleared and processes killed" });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/logs/:lambdaName - Get saved logs for a lambda
    "/api/logs/:lambdaName": {
      GET: async (req: Request) => {
        try {
          const lambdaName = decodeURIComponent(req.params.lambdaName);
          const logs = ctx.jobService.getSavedLogs(lambdaName);
          return Response.json({ logs });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // POST /api/logs - Save a new log
    "/api/logs": {
      POST: async (req: Request) => {
        try {
          const body = (await req.json()) as {
            lambdaName: string;
            name: string;
            content: string;
          };

          if (!body.lambdaName || !body.name || !body.content) {
            return Response.json({ error: "Missing lambdaName, name, or content" }, { status: 400 });
          }

          const log = ctx.jobService.saveLog(body.lambdaName, body.name, body.content);
          return Response.json({ log });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/logs/view/:id - Get a single saved log
    "/api/logs/view/:id": {
      GET: async (req: Request) => {
        try {
          const log = ctx.jobService.getSavedLog(req.params.id);
          if (!log) {
            return Response.json({ error: "Log not found" }, { status: 404 });
          }
          return Response.json({ log });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // DELETE /api/logs/:id - Delete a saved log
    "/api/logs/delete/:id": {
      POST: async (req: Request) => {
        try {
          const success = ctx.jobService.deleteSavedLog(req.params.id);
          if (!success) {
            return Response.json({ error: "Log not found" }, { status: 404 });
          }
          return Response.json({ success: true });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },
  };
}

/**
 * Execute a build job asynchronously
 */
async function executeBuildJob(
  jobId: string,
  target: string,
  backendPath: string,
  ctx: JobsApiContext,
  infraService: InfraService,
  builderService: LambdaBuilderService
) {
  try {
    const lambdas = await infraService.discoverLambdas(backendPath);

    if (target === "all") {
      await builderService.buildAll(lambdas, jobId);
    } else if (["dotnet", "js", "python", "typescript-edge"].includes(target)) {
      await builderService.buildByType(lambdas, target as any, jobId);
    } else {
      // Build specific lambda by name
      const lambda = lambdas.find((l) => l.name === target);
      if (!lambda) {
        ctx.jobService.updateJobStatus(jobId, "failed", `Lambda "${target}" not found`);
        return;
      }

      ctx.jobService.updateJobStatus(jobId, "running");
      const result = await builderService.buildLambda(lambda, jobId);

      if (result.success) {
        ctx.jobService.updateJobStatus(jobId, "completed");
      } else {
        ctx.jobService.updateJobStatus(jobId, "failed", result.error);
      }
    }
  } catch (error) {
    ctx.jobService.updateJobStatus(jobId, "failed", String(error));
  }
}

/**
 * Execute a CDK job asynchronously
 */
async function executeCdkJob(
  jobId: string,
  command: "diff" | "deploy" | "synth",
  target: string,
  infraPath: string,
  ctx: JobsApiContext
) {
  ctx.jobService.updateJobStatus(jobId, "running");
  ctx.jobService.appendOutput(jobId, `=== Running CDK ${command} on ${target} ===`);
  ctx.jobService.appendOutput(jobId, `Infrastructure path: ${infraPath}`);

  try {
    // Get current environment
    const currentEnv = ctx.cacheService.getCurrentEnvironment();
    const stage = ctx.cacheService.getInfraStage();

    if (!currentEnv) {
      throw new Error("No environment selected. Please select an environment first.");
    }

    // Determine stack name
    let stackName: string;
    if (target === "static-backend") {
      stackName = "backend";
    } else if (target === "beanstalk-backend") {
      stackName = "backend-beanstalk";
    } else {
      stackName = `${target}-${currentEnv}`;
    }

    // Set up environment variables
    const env = {
      ...process.env,
      STACK: target,
      SUFFIX: currentEnv,
      INFRA_STAGE: stage,
      REACT_APP_STAGE: stage,
      NODE_OPTIONS: "--max_old_space_size=8192",
    };

    ctx.jobService.appendOutput(jobId, `Stack: ${stackName}`);
    ctx.jobService.appendOutput(jobId, `Environment: ${currentEnv}`);
    ctx.jobService.appendOutput(jobId, `Stage: ${stage}`);
    ctx.jobService.appendOutput(jobId, ``);

    // Build command args - add --require-approval never for deploy to avoid interactive prompts
    const cdkArgs = ["cdk", command, stackName];
    if (command === "deploy") {
      cdkArgs.push("--require-approval", "never");
    }

    ctx.jobService.appendOutput(jobId, `> yarn ${cdkArgs.join(" ")}`);

    // Run CDK command
    const proc = Bun.spawn(["yarn", ...cdkArgs], {
      cwd: infraPath,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Register process for cancellation
    ctx.jobService.registerProcess(jobId, proc);

    // Stream both stdout and stderr in parallel
    const streamOutput = async (stream: ReadableStream<Uint8Array>, prefix?: string) => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            ctx.jobService.appendOutput(jobId, prefix ? `${prefix}${line}` : line);
          }
        }
      }

      if (buffer.trim()) {
        ctx.jobService.appendOutput(jobId, prefix ? `${prefix}${buffer}` : buffer);
      }
    };

    // Stream both stdout and stderr simultaneously (CDK outputs to stderr)
    await Promise.all([
      streamOutput(proc.stdout),
      streamOutput(proc.stderr),
    ]);

    const exitCode = await proc.exited;
    ctx.jobService.unregisterProcess(jobId);

    if (exitCode === 0) {
      ctx.jobService.appendOutput(jobId, `\n✓ CDK ${command} completed successfully`);
      ctx.jobService.updateJobStatus(jobId, "completed");
    } else {
      ctx.jobService.appendOutput(jobId, `\n✗ CDK ${command} failed with exit code ${exitCode}`);
      ctx.jobService.updateJobStatus(jobId, "failed", `Exit code ${exitCode}`);
    }
  } catch (error) {
    ctx.jobService.appendOutput(jobId, `\n✗ Error: ${error}`);
    ctx.jobService.updateJobStatus(jobId, "failed", String(error));
  }
}

/**
 * Execute a deploy-lambda job (build + deploy single lambda to AWS)
 */
async function executeDeployLambdaJob(
  jobId: string,
  localName: string,
  awsFunctionName: string,
  backendPath: string,
  ctx: JobsApiContext,
  infraService: InfraService,
  builderService: LambdaBuilderService
) {
  ctx.jobService.updateJobStatus(jobId, "running");
  ctx.jobService.appendOutput(jobId, `=== Deploy Lambda: ${localName} -> ${awsFunctionName} ===`);
  ctx.jobService.appendOutput(jobId, ``);

  try {
    // Find the lambda
    const lambdas = await infraService.discoverLambdas(backendPath);
    const lambda = lambdas.find((l) => l.name === localName);

    if (!lambda) {
      throw new Error(`Lambda "${localName}" not found locally`);
    }

    // Step 1: Build the lambda
    ctx.jobService.appendOutput(jobId, `[1/2] Building ${localName}...`);
    ctx.jobService.appendOutput(jobId, ``);

    const buildResult = await builderService.buildLambda(lambda, jobId);

    if (!buildResult.success) {
      throw new Error(`Build failed: ${buildResult.error}`);
    }

    ctx.jobService.appendOutput(jobId, ``);
    ctx.jobService.appendOutput(jobId, `✓ Build completed`);
    ctx.jobService.appendOutput(jobId, ``);

    // Step 2: Deploy to AWS
    ctx.jobService.appendOutput(jobId, `[2/2] Deploying to AWS Lambda: ${awsFunctionName}...`);
    ctx.jobService.appendOutput(jobId, ``);

    // Find the zip file path based on lambda type
    let zipPath: string;
    if (lambda.type === "dotnet") {
      zipPath = lambda.outputPath;
    } else {
      zipPath = lambda.outputPath;
    }

    // Verify zip exists
    const zipFile = Bun.file(zipPath);
    if (!(await zipFile.exists())) {
      throw new Error(`Deployment zip not found at: ${zipPath}`);
    }

    ctx.jobService.appendOutput(jobId, `> aws lambda update-function-code --function-name ${awsFunctionName} --zip-file fileb://${zipPath}`);

    // Run AWS CLI to update the function code
    const proc = Bun.spawn(
      ["aws", "lambda", "update-function-code", "--function-name", awsFunctionName, "--zip-file", `fileb://${zipPath}`, "--no-cli-pager"],
      {
        cwd: backendPath,
        stdout: "pipe",
        stderr: "pipe",
      }
    );

    ctx.jobService.registerProcess(jobId, proc);

    // Stream output
    const streamOutput = async (stream: ReadableStream<Uint8Array>) => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            ctx.jobService.appendOutput(jobId, line);
          }
        }
      }

      if (buffer.trim()) {
        ctx.jobService.appendOutput(jobId, buffer);
      }
    };

    await Promise.all([streamOutput(proc.stdout), streamOutput(proc.stderr)]);

    const exitCode = await proc.exited;
    ctx.jobService.unregisterProcess(jobId);

    if (exitCode === 0) {
      ctx.jobService.appendOutput(jobId, ``);
      ctx.jobService.appendOutput(jobId, `✓ Successfully deployed ${localName} to ${awsFunctionName}`);
      ctx.jobService.updateJobStatus(jobId, "completed");

      // Invalidate AWS lambdas cache so next fetch gets fresh data
      const currentEnv = ctx.cacheService.getCurrentEnvironment();
      if (currentEnv) {
        ctx.cacheService.invalidate(`aws-lambdas-${currentEnv}`);
      }
    } else {
      throw new Error(`AWS CLI failed with exit code ${exitCode}`);
    }
  } catch (error) {
    ctx.jobService.appendOutput(jobId, ``);
    ctx.jobService.appendOutput(jobId, `✗ Error: ${error}`);
    ctx.jobService.updateJobStatus(jobId, "failed", String(error));
  }
}

/**
 * Execute a tail-logs job (stream CloudWatch logs for a Lambda function)
 */
async function executeTailLogsJob(
  jobId: string,
  awsFunctionName: string,
  ctx: JobsApiContext,
  infraService: InfraService
) {
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
    // Start tailing logs from now (live tail only)
    const logGenerator = infraService.tailLambdaLogs(awsFunctionName, {
      startTime: Date.now(),
      pollIntervalMs: 2000,
      signal: abortController.signal,
    });

    let eventCount = 0;
    const maxEvents = 500; // Stop after 500 events to prevent infinite running

    for await (const event of logGenerator) {
      if (abortController.signal.aborted) break;

      // Format the log event
      const timestamp = new Date(event.timestamp).toLocaleTimeString();
      const message = event.message.trim();

      // Skip empty messages
      if (!message) continue;

      ctx.jobService.appendOutput(jobId, `[${timestamp}] ${message}`);
      eventCount++;

      // Check if we've hit the max
      if (eventCount >= maxEvents) {
        ctx.jobService.appendOutput(jobId, ``);
        ctx.jobService.appendOutput(jobId, `--- Reached ${maxEvents} events limit. Stopping tail. ---`);
        break;
      }
    }

    ctx.jobService.unregisterProcess(jobId);

    if (abortController.signal.aborted) {
      ctx.jobService.appendOutput(jobId, ``);
      ctx.jobService.appendOutput(jobId, `--- Log tailing stopped ---`);
      ctx.jobService.updateJobStatus(jobId, "cancelled");
    } else {
      ctx.jobService.appendOutput(jobId, ``);
      ctx.jobService.appendOutput(jobId, `--- End of log tail ---`);
      ctx.jobService.updateJobStatus(jobId, "completed");
    }
  } catch (error: any) {
    ctx.jobService.unregisterProcess(jobId);
    ctx.jobService.appendOutput(jobId, ``);
    ctx.jobService.appendOutput(jobId, `✗ Error: ${error.message || error}`);
    ctx.jobService.updateJobStatus(jobId, "failed", String(error));
  }
}
