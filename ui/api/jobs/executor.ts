import type { JobStrategy, JobContext, JobParams } from "./strategies/types";
import { BuildJobStrategy } from "./strategies/BuildJobStrategy";
import { CdkJobStrategy } from "./strategies/CdkJobStrategy";
import { DeployLambdaJobStrategy } from "./strategies/DeployLambdaJobStrategy";
import { TailLogsJobStrategy } from "./strategies/TailLogsJobStrategy";

const strategies: Record<string, JobStrategy> = {
  build: new BuildJobStrategy(),
  deploy: new CdkJobStrategy("deploy"),
  diff: new CdkJobStrategy("diff"),
  synth: new CdkJobStrategy("synth"),
  "deploy-lambda": new DeployLambdaJobStrategy(),
  "tail-logs": new TailLogsJobStrategy(),
};

export async function executeJob(
  jobId: string,
  type: string,
  params: JobParams,
  ctx: JobContext
): Promise<void> {
  const strategy = strategies[type];
  if (!strategy) {
    ctx.jobService.updateJobStatus(jobId, "failed", `Unknown job type: ${type}`);
    return;
  }
  await strategy.execute(jobId, params, ctx);
}
