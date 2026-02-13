import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import type { JobStrategy, JobParams, JobContext } from "./types";
import { stripAnsi, streamProcessOutput } from "../streamProcess";

const isWindows = os.platform() === "win32";
const yarnCmd = isWindows ? "yarn.cmd" : "yarn";

export class BuildDeployAllJobStrategy implements JobStrategy {
  async execute(jobId: string, params: JobParams, ctx: JobContext): Promise<void> {
    const { target } = params;

    if (target === "backend") {
      await this.executeBackend(jobId, params, ctx);
    } else if (target === "frontend") {
      await this.executeFrontend(jobId, params, ctx);
    } else {
      ctx.jobService.updateJobStatus(jobId, "failed", `Unknown build-deploy-all target: ${target}`);
    }
  }

  /**
   * Backend flow: build all lambdas, then CDK deploy backend stack with approval
   */
  private async executeBackend(jobId: string, params: JobParams, ctx: JobContext): Promise<void> {
    const { backendPath, infraPath } = params;

    if (!backendPath || !infraPath) {
      ctx.jobService.updateJobStatus(jobId, "failed", "Missing backendPath or infraPath");
      return;
    }

    ctx.jobService.updateJobStatus(jobId, "running");
    ctx.jobService.appendOutput(jobId, `=== Build & Deploy All (Backend) ===`);
    ctx.jobService.appendOutput(jobId, ``);

    try {
      // Phase 1: Build all lambdas
      ctx.jobService.appendOutput(jobId, `Phase 1: Building all lambdas...`);
      ctx.jobService.appendOutput(jobId, ``);

      const lambdas = await ctx.infraService.discoverLambdas(backendPath);
      await ctx.builderService.buildAll(lambdas, jobId, undefined, backendPath);

      // Check if the job was cancelled during build
      const jobAfterBuild = ctx.jobService.getJob(jobId);
      if (!jobAfterBuild || jobAfterBuild.status === "cancelled" || jobAfterBuild.status === "failed") {
        return;
      }

      // Reset status to running if buildAll set it to completed
      ctx.jobService.updateJobStatus(jobId, "running");

      ctx.jobService.appendOutput(jobId, ``);
      ctx.jobService.appendOutput(jobId, `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);

      // Phase 2: CDK deploy backend stack with approval
      await this.cdkDeployWithApproval(jobId, "backend", infraPath, ctx);
    } catch (error) {
      ctx.jobService.appendOutput(jobId, `\n\u2717 Error: ${error}`);
      ctx.jobService.updateJobStatus(jobId, "failed", String(error));
    }
  }

  /**
   * Frontend flow: build clients/web, then CDK deploy frontend stack with approval
   */
  private async executeFrontend(jobId: string, params: JobParams, ctx: JobContext): Promise<void> {
    const { clientsPath, infraPath } = params;

    if (!clientsPath || !infraPath) {
      ctx.jobService.updateJobStatus(jobId, "failed", "Missing clientsPath or infraPath");
      return;
    }

    const webPath = path.join(clientsPath, "web");
    if (!fs.existsSync(webPath)) {
      ctx.jobService.updateJobStatus(jobId, "failed", `Directory not found: ${webPath}`);
      return;
    }

    ctx.jobService.updateJobStatus(jobId, "running");
    ctx.jobService.appendOutput(jobId, `=== Build & Deploy All (Frontend) ===`);
    ctx.jobService.appendOutput(jobId, ``);

    try {
      // Phase 1: Build clients/web
      ctx.jobService.appendOutput(jobId, `Phase 1: Building clients/web...`);
      ctx.jobService.appendOutput(jobId, ``);

      // Check if node_modules exists
      const nodeModulesPath = path.join(webPath, "node_modules");
      if (!fs.existsSync(nodeModulesPath)) {
        ctx.jobService.appendOutput(jobId, `> yarn install --frozen-lockfile`);
        ctx.jobService.appendOutput(jobId, ``);

        const installProc = Bun.spawn([yarnCmd, "install", "--frozen-lockfile"], {
          cwd: webPath,
          env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
          stdout: "pipe",
          stderr: "pipe",
        });

        ctx.jobService.registerProcess(jobId, installProc);
        const { exitCode: installExitCode } = await streamProcessOutput(installProc, jobId, ctx.jobService);
        ctx.jobService.unregisterProcess(jobId);

        if (installExitCode !== 0) {
          ctx.jobService.appendOutput(jobId, `\n\u2717 yarn install failed with exit code ${installExitCode}`);
          ctx.jobService.updateJobStatus(jobId, "failed", `yarn install failed with exit code ${installExitCode}`);
          return;
        }

        ctx.jobService.appendOutput(jobId, ``);
      }

      ctx.jobService.appendOutput(jobId, `> yarn build`);
      ctx.jobService.appendOutput(jobId, ``);

      const buildProc = Bun.spawn([yarnCmd, "build"], {
        cwd: webPath,
        env: {
          ...process.env,
          NODE_OPTIONS: "--max-old-space-size=8192",
          NO_COLOR: "1",
          FORCE_COLOR: "0",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      ctx.jobService.registerProcess(jobId, buildProc);
      const { exitCode: buildExitCode } = await streamProcessOutput(buildProc, jobId, ctx.jobService);
      ctx.jobService.unregisterProcess(jobId);

      if (buildExitCode !== 0) {
        ctx.jobService.appendOutput(jobId, `\n\u2717 Frontend build failed with exit code ${buildExitCode}`);
        ctx.jobService.updateJobStatus(jobId, "failed", `Frontend build failed with exit code ${buildExitCode}`);
        return;
      }

      ctx.jobService.appendOutput(jobId, `\n\u2713 Frontend build completed`);
      ctx.jobService.appendOutput(jobId, ``);
      ctx.jobService.appendOutput(jobId, `\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501`);

      // Phase 2: CDK deploy frontend stack with approval
      await this.cdkDeployWithApproval(jobId, "frontend", infraPath, ctx);
    } catch (error) {
      ctx.jobService.appendOutput(jobId, `\n\u2717 Error: ${error}`);
      ctx.jobService.updateJobStatus(jobId, "failed", String(error));
    }
  }

  /**
   * Shared CDK deploy with approval flow (reused from CdkJobStrategy pattern)
   */
  private async cdkDeployWithApproval(
    jobId: string,
    stackType: string,
    infraPath: string,
    ctx: JobContext
  ): Promise<void> {
    const currentEnv = await ctx.configService.getCurrentEnvironment();
    const stage = await ctx.configService.getInfraStage();

    if (!currentEnv) {
      throw new Error("No environment selected. Please select an environment first.");
    }

    const stackName = `${stackType}-${currentEnv}`;

    const env = {
      ...process.env,
      STACK: stackType,
      SUFFIX: currentEnv,
      INFRA_STAGE: stage,
      REACT_APP_STAGE: stage,
      NODE_OPTIONS: "--max_old_space_size=8192",
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    };

    ctx.jobService.appendOutput(jobId, ``);
    ctx.jobService.appendOutput(jobId, `Phase 2: CDK deploy ${stackName}`);
    ctx.jobService.appendOutput(jobId, `Environment: ${currentEnv}, Stage: ${stage}`);
    ctx.jobService.appendOutput(jobId, ``);

    // Run cdk diff first
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
          if (line.match(/^\s*\[\+\]/) || line.match(/^\s*\[-\]/) || line.match(/^\s*\[~\]/)) {
            hasChanges = true;
          }
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

    if (diffExitCode !== 0 && diffExitCode !== 1) {
      ctx.jobService.appendOutput(jobId, `\n\u2717 CDK diff failed with exit code ${diffExitCode}`);
      ctx.jobService.updateJobStatus(jobId, "failed", `Diff failed with exit code ${diffExitCode}`);
      return;
    }

    if (diffExitCode === 0 && !hasChanges) {
      ctx.jobService.appendOutput(jobId, ``);
      ctx.jobService.appendOutput(jobId, `\u2713 No changes to deploy - stack is up to date`);
      ctx.jobService.updateJobStatus(jobId, "completed");
      return;
    }

    // Wait for approval
    ctx.jobService.appendOutput(jobId, ``);
    ctx.jobService.appendOutput(jobId, `\u23f8\ufe0f  Changes detected - waiting for approval...`);

    ctx.jobService.setAwaitingApproval(jobId, diffOutput);

    const approved = await this.waitForApproval(jobId, ctx);

    if (!approved) {
      ctx.jobService.appendOutput(jobId, ``);
      ctx.jobService.appendOutput(jobId, `\u23f9\ufe0f  Deploy rejected by user`);
      ctx.jobService.updateJobStatus(jobId, "cancelled");
      return;
    }

    // Run the actual deploy
    ctx.jobService.appendOutput(jobId, ``);
    ctx.jobService.appendOutput(jobId, `Phase 3: Deploying ${stackName}...`);
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
    const { exitCode: deployExitCode } = await streamProcessOutput(deployProc, jobId, ctx.jobService);
    ctx.jobService.unregisterProcess(jobId);

    if (deployExitCode === 0) {
      ctx.jobService.appendOutput(jobId, `\n\u2713 CDK deploy completed successfully`);
      ctx.jobService.updateJobStatus(jobId, "completed");
    } else {
      ctx.jobService.appendOutput(jobId, `\n\u2717 CDK deploy failed with exit code ${deployExitCode}`);
      ctx.jobService.updateJobStatus(jobId, "failed", `Exit code ${deployExitCode}`);
    }
  }

  private waitForApproval(jobId: string, ctx: JobContext): Promise<boolean> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const job = ctx.jobService.getJob(jobId);
        if (!job) {
          clearInterval(checkInterval);
          resolve(false);
          return;
        }

        if (job.status === "running") {
          clearInterval(checkInterval);
          resolve(true);
        } else if (job.status === "cancelled" || job.status === "failed") {
          clearInterval(checkInterval);
          resolve(false);
        }
      }, 500);
    });
  }
}
