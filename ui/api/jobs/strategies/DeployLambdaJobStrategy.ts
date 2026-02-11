import type { JobStrategy, JobParams, JobContext } from "./types";
import { streamProcessOutput } from "../streamProcess";

export class DeployLambdaJobStrategy implements JobStrategy {
  async execute(jobId: string, params: JobParams, ctx: JobContext): Promise<void> {
    const { target: localName, awsFunctionName, backendPath } = params;

    if (!awsFunctionName) {
      ctx.jobService.updateJobStatus(jobId, "failed", "Missing AWS function name");
      return;
    }

    if (!backendPath) {
      ctx.jobService.updateJobStatus(jobId, "failed", "Missing backendPath");
      return;
    }

    ctx.jobService.updateJobStatus(jobId, "running");
    ctx.jobService.appendOutput(jobId, `=== Deploy Lambda: ${localName} -> ${awsFunctionName} ===`);
    ctx.jobService.appendOutput(jobId, ``);

    try {
      // Find the lambda
      const lambdas = await ctx.infraService.discoverLambdas(backendPath);
      const lambda = lambdas.find((l) => l.name === localName);

      if (!lambda) {
        throw new Error(`Lambda "${localName}" not found locally`);
      }

      // Step 1: Build the lambda
      ctx.jobService.appendOutput(jobId, `[1/2] Building ${localName}...`);
      ctx.jobService.appendOutput(jobId, ``);

      const buildResult = await ctx.builderService.buildLambda(lambda, jobId);

      if (!buildResult.success) {
        throw new Error(`Build failed: ${buildResult.error}`);
      }

      ctx.jobService.appendOutput(jobId, ``);
      ctx.jobService.appendOutput(jobId, `\u2713 Build completed`);
      ctx.jobService.appendOutput(jobId, ``);

      // Step 2: Deploy to AWS
      ctx.jobService.appendOutput(jobId, `[2/2] Deploying to AWS Lambda: ${awsFunctionName}...`);
      ctx.jobService.appendOutput(jobId, ``);

      // Find the zip file path based on lambda type
      const zipPath = lambda.outputPath;

      // Verify zip exists
      const zipFile = Bun.file(zipPath);
      if (!(await zipFile.exists())) {
        throw new Error(`Deployment zip not found at: ${zipPath}`);
      }

      ctx.jobService.appendOutput(
        jobId,
        `> aws lambda update-function-code --function-name ${awsFunctionName} --zip-file fileb://${zipPath}`
      );

      // Run AWS CLI to update the function code
      const proc = Bun.spawn(
        [
          "aws",
          "lambda",
          "update-function-code",
          "--function-name",
          awsFunctionName,
          "--zip-file",
          `fileb://${zipPath}`,
          "--no-cli-pager",
        ],
        {
          cwd: backendPath,
          stdout: "pipe",
          stderr: "pipe",
        }
      );

      ctx.jobService.registerProcess(jobId, proc);

      const { exitCode } = await streamProcessOutput(proc, jobId, ctx.jobService);

      ctx.jobService.unregisterProcess(jobId);

      if (exitCode === 0) {
        ctx.jobService.appendOutput(jobId, ``);
        ctx.jobService.appendOutput(jobId, `\u2713 Successfully deployed ${localName} to ${awsFunctionName}`);
        ctx.jobService.updateJobStatus(jobId, "completed");

        // Invalidate AWS lambdas cache so next fetch gets fresh data
        const currentEnv = await ctx.configService.getCurrentEnvironment();
        if (currentEnv) {
          ctx.cacheService.invalidate(`aws-lambdas-${currentEnv}`);
        }
      } else {
        throw new Error(`AWS CLI failed with exit code ${exitCode}`);
      }
    } catch (error) {
      ctx.jobService.appendOutput(jobId, ``);
      ctx.jobService.appendOutput(jobId, `\u2717 Error: ${error}`);
      ctx.jobService.updateJobStatus(jobId, "failed", String(error));
    }
  }
}
