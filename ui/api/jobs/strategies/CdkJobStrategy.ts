import * as os from "os";
import type { JobStrategy, JobParams, JobContext } from "./types";
import { stripAnsi, streamProcessOutput } from "../streamProcess";

const isWindows = os.platform() === "win32";
const yarnCmd = isWindows ? "yarn.cmd" : "yarn";

export class CdkJobStrategy implements JobStrategy {
  constructor(private command: "diff" | "deploy" | "synth") {}

  async execute(jobId: string, params: JobParams, ctx: JobContext): Promise<void> {
    const { target, infraPath } = params;

    if (!infraPath) {
      ctx.jobService.updateJobStatus(jobId, "failed", "Missing infraPath");
      return;
    }

    ctx.jobService.updateJobStatus(jobId, "running");
    ctx.jobService.appendOutput(jobId, `=== Running CDK ${this.command} on ${target} ===`);
    ctx.jobService.appendOutput(jobId, `Infrastructure path: ${infraPath}`);

    try {
      // Get current environment from configService (stores in buddy.json)
      const currentEnv = await ctx.configService.getCurrentEnvironment();
      const stage = await ctx.configService.getInfraStage();

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
        // Disable color output since we're displaying in a web UI
        NO_COLOR: "1",
        FORCE_COLOR: "0",
      };

      ctx.jobService.appendOutput(jobId, `Stack: ${stackName}`);
      ctx.jobService.appendOutput(jobId, `Environment: ${currentEnv}`);
      ctx.jobService.appendOutput(jobId, `Stage: ${stage}`);
      ctx.jobService.appendOutput(jobId, ``);

      // For deploy, use interactive mode to show changeset and wait for approval
      if (this.command === "deploy") {
        await this.executeCdkDeployWithApproval(jobId, stackName, infraPath, env, ctx);
      } else {
        // For diff/synth, run non-interactively
        await this.executeCdkNonInteractive(jobId, stackName, infraPath, env, ctx);
      }
    } catch (error) {
      ctx.jobService.appendOutput(jobId, `\n\u2717 Error: ${error}`);
      ctx.jobService.updateJobStatus(jobId, "failed", String(error));
    }
  }

  /**
   * Execute CDK deploy with approval - two phase approach:
   * 1. Run cdk diff to get changes
   * 2. Show approval modal
   * 3. If approved, run cdk deploy
   */
  private async executeCdkDeployWithApproval(
    jobId: string,
    stackName: string,
    infraPath: string,
    env: Record<string, string | undefined>,
    ctx: JobContext
  ): Promise<void> {
    // Phase 1: Run cdk diff to get the changes
    ctx.jobService.appendOutput(jobId, `Phase 1: Calculating changes...`);
    ctx.jobService.appendOutput(jobId, ``);
    ctx.jobService.appendOutput(jobId, `> yarn cdk diff ${stackName}`);
    ctx.jobService.appendOutput(jobId, ``);

    const diffProc = Bun.spawn([yarnCmd, "cdk", "diff", stackName], {
      cwd: infraPath,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    ctx.jobService.registerProcess(jobId, diffProc);

    const diffOutput: string[] = [];
    let hasChanges = false;

    const streamDiffOutput = async (stream: ReadableStream<Uint8Array>) => {
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
          diffOutput.push(line);
          if (line.trim()) {
            ctx.jobService.appendOutput(jobId, line);
          }
          // Detect if there are actual changes
          if (line.match(/^\s*\[\+\]/) || line.match(/^\s*\[-\]/) || line.match(/^\s*\[~\]/)) {
            hasChanges = true;
          }
          // Also check for "Resources" section or IAM changes
          if (line.includes("IAM Statement Changes") || line.includes("Security Group Changes")) {
            hasChanges = true;
          }
        }
      }

      if (buffer.trim()) {
        const line = stripAnsi(buffer);
        diffOutput.push(line);
        ctx.jobService.appendOutput(jobId, line);
      }
    };

    await Promise.all([
      streamDiffOutput(diffProc.stdout),
      streamDiffOutput(diffProc.stderr),
    ]);

    const diffExitCode = await diffProc.exited;
    ctx.jobService.unregisterProcess(jobId);

    // Exit code 1 means there are differences, 0 means no changes
    if (diffExitCode !== 0 && diffExitCode !== 1) {
      ctx.jobService.appendOutput(jobId, `\n\u2717 CDK diff failed with exit code ${diffExitCode}`);
      ctx.jobService.updateJobStatus(jobId, "failed", `Diff failed with exit code ${diffExitCode}`);
      return;
    }

    // Check if there are any changes to deploy
    if (diffExitCode === 0 && !hasChanges) {
      ctx.jobService.appendOutput(jobId, ``);
      ctx.jobService.appendOutput(jobId, `\u2713 No changes to deploy - stack is up to date`);
      ctx.jobService.updateJobStatus(jobId, "completed");
      return;
    }

    // Phase 2: Wait for user approval
    ctx.jobService.appendOutput(jobId, ``);
    ctx.jobService.appendOutput(jobId, `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);
    ctx.jobService.appendOutput(jobId, `\u23f8\ufe0f  Changes detected - waiting for approval...`);
    ctx.jobService.appendOutput(jobId, `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);

    // Set job to awaiting approval with the diff output
    ctx.jobService.setAwaitingApproval(jobId, diffOutput);

    // Wait for approval response
    const approved = await this.waitForApproval(jobId, ctx);

    if (!approved) {
      ctx.jobService.appendOutput(jobId, ``);
      ctx.jobService.appendOutput(jobId, `\u23f9\ufe0f  Deploy rejected by user`);
      ctx.jobService.updateJobStatus(jobId, "cancelled");
      return;
    }

    // Phase 3: Run the actual deploy
    ctx.jobService.appendOutput(jobId, ``);
    ctx.jobService.appendOutput(jobId, `Phase 2: Deploying changes...`);
    ctx.jobService.appendOutput(jobId, ``);
    ctx.jobService.appendOutput(jobId, `> yarn cdk deploy ${stackName} --require-approval never`);
    ctx.jobService.appendOutput(jobId, ``);

    const deployProc = Bun.spawn([yarnCmd, "cdk", "deploy", stackName, "--require-approval", "never"], {
      cwd: infraPath,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    ctx.jobService.registerProcess(jobId, deployProc);

    const { exitCode: deployExitCode } = await streamProcessOutput(
      deployProc,
      jobId,
      ctx.jobService
    );

    ctx.jobService.unregisterProcess(jobId);

    if (deployExitCode === 0) {
      ctx.jobService.appendOutput(jobId, `\n\u2713 CDK deploy completed successfully`);
      ctx.jobService.updateJobStatus(jobId, "completed");
    } else {
      ctx.jobService.appendOutput(jobId, `\n\u2717 CDK deploy failed with exit code ${deployExitCode}`);
      ctx.jobService.updateJobStatus(jobId, "failed", `Exit code ${deployExitCode}`);
    }
  }

  /**
   * Wait for user approval response
   */
  private waitForApproval(jobId: string, ctx: JobContext): Promise<boolean> {
    return new Promise((resolve) => {
      // Check every 500ms if the job status changed from awaiting_approval
      const checkInterval = setInterval(() => {
        const job = ctx.jobService.getJob(jobId);
        if (!job) {
          clearInterval(checkInterval);
          resolve(false);
          return;
        }

        if (job.status === "running") {
          // User approved
          clearInterval(checkInterval);
          resolve(true);
        } else if (job.status === "cancelled" || job.status === "failed") {
          // User rejected or job was cancelled
          clearInterval(checkInterval);
          resolve(false);
        }
        // If still awaiting_approval, keep waiting
      }, 500);
    });
  }

  /**
   * Execute CDK command non-interactively (for diff, synth)
   */
  private async executeCdkNonInteractive(
    jobId: string,
    stackName: string,
    infraPath: string,
    env: Record<string, string | undefined>,
    ctx: JobContext
  ): Promise<void> {
    const cdkArgs = ["cdk", this.command, stackName];

    ctx.jobService.appendOutput(jobId, `> yarn ${cdkArgs.join(" ")}`);

    const proc = Bun.spawn([yarnCmd, ...cdkArgs], {
      cwd: infraPath,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    ctx.jobService.registerProcess(jobId, proc);

    const { exitCode } = await streamProcessOutput(proc, jobId, ctx.jobService);

    ctx.jobService.unregisterProcess(jobId);

    if (exitCode === 0) {
      ctx.jobService.appendOutput(jobId, `\n\u2713 CDK ${this.command} completed successfully`);
      ctx.jobService.updateJobStatus(jobId, "completed");
    } else {
      ctx.jobService.appendOutput(jobId, `\n\u2717 CDK ${this.command} failed with exit code ${exitCode}`);
      ctx.jobService.updateJobStatus(jobId, "failed", `Exit code ${exitCode}`);
    }
  }
}
