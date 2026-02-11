import type { JobStrategy, JobParams, JobContext } from "./types";

export class BuildJobStrategy implements JobStrategy {
  async execute(jobId: string, params: JobParams, ctx: JobContext): Promise<void> {
    const { target, backendPath } = params;

    if (!backendPath) {
      ctx.jobService.updateJobStatus(jobId, "failed", "Missing backendPath");
      return;
    }

    try {
      const lambdas = await ctx.infraService.discoverLambdas(backendPath);

      if (target === "all") {
        // Build all lambdas - uses two-phase approach for .NET
        await ctx.builderService.buildAll(lambdas, jobId, undefined, backendPath);
      } else if (target === "dotnet") {
        // Build all .NET lambdas - uses two-phase approach
        await ctx.builderService.buildByType(lambdas, target as any, jobId, backendPath);
      } else if (["js", "python", "typescript-edge"].includes(target)) {
        // Non-.NET types don't need shared project pre-build
        await ctx.builderService.buildByType(lambdas, target as any, jobId);
      } else {
        // Build specific lambda by name
        const lambda = lambdas.find((l) => l.name === target);
        if (!lambda) {
          ctx.jobService.updateJobStatus(jobId, "failed", `Lambda "${target}" not found`);
          return;
        }

        ctx.jobService.updateJobStatus(jobId, "running");

        // For single .NET lambda, still pre-build shared projects for faster subsequent builds
        if (lambda.type === "dotnet") {
          await ctx.builderService.buildSharedProjects(backendPath, jobId);
        }

        const result = await ctx.builderService.buildLambda(lambda, jobId);

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
}
