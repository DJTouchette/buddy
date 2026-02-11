import type { JobService } from "../../../../services/jobService";
import type { ConfigService } from "../../../../services/configService";
import type { CacheService } from "../../../../services/cacheService";
import type { InfraService } from "../../../../services/infraService";
import type { LambdaBuilderService } from "../../../../services/lambdaBuilderService";

export interface JobContext {
  jobService: JobService;
  configService: ConfigService;
  cacheService: CacheService;
  infraService: InfraService;
  builderService: LambdaBuilderService;
}

export interface JobStrategy {
  execute(jobId: string, params: JobParams, ctx: JobContext): Promise<void>;
}

export interface JobParams {
  target: string;
  backendPath?: string;
  infraPath?: string;
  awsFunctionName?: string;
  skipBuild?: boolean;
}
