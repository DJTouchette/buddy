import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import type { JobStrategy, JobParams, JobContext } from "./types";
import { streamProcessOutput } from "../streamProcess";

const isWindows = os.platform() === "win32";
const yarnCmd = isWindows ? "yarn.cmd" : "yarn";

export class FrontendBuildJobStrategy implements JobStrategy {
  async execute(jobId: string, params: JobParams, ctx: JobContext): Promise<void> {
    const { target, clientsPath } = params;

    if (!clientsPath) {
      ctx.jobService.updateJobStatus(jobId, "failed", "Missing clientsPath");
      return;
    }

    const projectPath = path.join(clientsPath, target);

    // Verify the directory exists
    if (!fs.existsSync(projectPath)) {
      ctx.jobService.updateJobStatus(jobId, "failed", `Directory not found: ${projectPath}`);
      return;
    }

    ctx.jobService.updateJobStatus(jobId, "running");
    ctx.jobService.appendOutput(jobId, `=== Building frontend: ${target} ===`);
    ctx.jobService.appendOutput(jobId, `Path: ${projectPath}`);
    ctx.jobService.appendOutput(jobId, ``);

    try {
      // Check if node_modules exists, if not run yarn install
      const nodeModulesPath = path.join(projectPath, "node_modules");
      if (!fs.existsSync(nodeModulesPath)) {
        ctx.jobService.appendOutput(jobId, `> yarn install --frozen-lockfile`);
        ctx.jobService.appendOutput(jobId, ``);

        const installProc = Bun.spawn([yarnCmd, "install", "--frozen-lockfile"], {
          cwd: projectPath,
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

      // Run yarn build
      ctx.jobService.appendOutput(jobId, `> yarn build`);
      ctx.jobService.appendOutput(jobId, ``);

      const buildProc = Bun.spawn([yarnCmd, "build"], {
        cwd: projectPath,
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
      const { exitCode } = await streamProcessOutput(buildProc, jobId, ctx.jobService);
      ctx.jobService.unregisterProcess(jobId);

      if (exitCode === 0) {
        ctx.jobService.appendOutput(jobId, `\n\u2713 Frontend build completed successfully`);
        ctx.jobService.updateJobStatus(jobId, "completed");
      } else {
        ctx.jobService.appendOutput(jobId, `\n\u2717 Frontend build failed with exit code ${exitCode}`);
        ctx.jobService.updateJobStatus(jobId, "failed", `Exit code ${exitCode}`);
      }
    } catch (error) {
      ctx.jobService.appendOutput(jobId, `\n\u2717 Error: ${error}`);
      ctx.jobService.updateJobStatus(jobId, "failed", String(error));
    }
  }
}
