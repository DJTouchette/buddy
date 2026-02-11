import { InfraService } from "../../services/infraService";
import type { ApiContext } from "./context";
import type { ConfigService } from "../../services/configService";
import { handler, errorResponse } from "./helpers";

export async function isProtectedEnvironment(env: string | null, configService: ConfigService): Promise<boolean> {
  if (!env) return false;
  const protectedEnvs = await configService.getProtectedEnvironments();
  return protectedEnvs.some(
    (p) => env.toLowerCase() === p.toLowerCase()
  );
}

export function infraRoutes(ctx: ApiContext) {
  const infraService = new InfraService();

  return {
    // GET /api/infra/environments - List all environments from CloudFormation
    "/api/infra/environments": {
      GET: handler(async () => {
        const environments = await infraService.listEnvironments();
        const currentEnv = await ctx.configService.getCurrentEnvironment();

        return Response.json({
          environments,
          currentEnvironment: currentEnv,
        });
      }),
    },

    // GET/PUT /api/infra/environments/current - Get/set current environment
    "/api/infra/environments/current": {
      GET: handler(async () => {
        const currentEnv = await ctx.configService.getCurrentEnvironment();
        const stage = await ctx.configService.getInfraStage();

        return Response.json({
          currentEnvironment: currentEnv,
          stage,
          isProtected: await isProtectedEnvironment(currentEnv, ctx.configService),
        });
      }),
      PUT: handler(async (req: Request) => {
        const body = (await req.json()) as { environment: string | null; stage?: string };

        if (body.environment !== undefined) {
          await ctx.configService.setCurrentEnvironment(body.environment);
        }

        if (body.stage) {
          await ctx.configService.setInfraStage(body.stage as "dev" | "prod" | "staging" | "int" | "demo");
        }

        return Response.json({
          currentEnvironment: await ctx.configService.getCurrentEnvironment(),
          stage: await ctx.configService.getInfraStage(),
        });
      }),
    },

    // GET /api/infra/stacks - Get stacks for current environment
    "/api/infra/stacks": {
      GET: handler(async () => {
        const currentEnv = await ctx.configService.getCurrentEnvironment();

        if (!currentEnv) {
          return Response.json({ stacks: [], message: "No environment selected" });
        }

        const stacks = await infraService.getStacksForEnvironment(currentEnv);

        return Response.json({
          environment: currentEnv,
          stacks,
        });
      }),
    },

    // GET /api/infra/lambdas - List all discovered lambdas
    "/api/infra/lambdas": {
      GET: handler(async () => {
        const selectedRepo = ctx.cacheService.getSelectedRepo();

        if (!selectedRepo) {
          return Response.json({
            lambdas: [],
            error: "No repository selected. Go to Git page and select a repo first.",
          });
        }

        const paths = infraService.getInfraPaths(selectedRepo.path);

        if (!paths) {
          return Response.json({
            lambdas: [],
            error: "Selected repository doesn't appear to be an infrastructure repo (no cdk.json found)",
          });
        }

        const lambdas = await infraService.discoverLambdas(paths.backendPath);

        return Response.json({
          lambdas,
          backendPath: paths.backendPath,
          infraPath: paths.infraPath,
          repoName: selectedRepo.name,
        });
      }),
    },

    // GET /api/infra/config - Get infrastructure paths from selected repo
    "/api/infra/config": {
      GET: handler(async () => {
        const selectedRepo = ctx.cacheService.getSelectedRepo();
        const currentEnv = await ctx.configService.getCurrentEnvironment();
        const stage = await ctx.configService.getInfraStage();

        if (!selectedRepo) {
          return Response.json({
            configured: false,
            error: "No repository selected",
          });
        }

        const paths = infraService.getInfraPaths(selectedRepo.path);

        if (!paths) {
          return Response.json({
            configured: false,
            error: "Selected repository doesn't have infrastructure folder",
          });
        }

        return Response.json({
          configured: true,
          repoName: selectedRepo.name,
          repoPath: selectedRepo.path,
          infraPath: paths.infraPath,
          backendPath: paths.backendPath,
          currentEnvironment: currentEnv,
          stage,
        });
      }),
    },

    // GET /api/infra/lambdas/dirty - Check which lambdas have changes since last build
    "/api/infra/lambdas/dirty": {
      GET: handler(async () => {
        const selectedRepo = ctx.cacheService.getSelectedRepo();

        if (!selectedRepo) {
          return errorResponse("No repository selected", 400);
        }

        const paths = infraService.getInfraPaths(selectedRepo.path);

        if (!paths) {
          return errorResponse("Not an infrastructure repo", 400);
        }

        const lambdas = await infraService.discoverLambdas(paths.backendPath);

        // Get build info from job service
        const buildInfoMap = ctx.jobService.getAllLambdaBuildInfo();

        // Check dirty status
        const dirtyStatus = await infraService.checkAllLambdasDirty(
          lambdas,
          buildInfoMap,
          selectedRepo.path
        );

        // Convert map to object for JSON
        const dirty: Record<string, { isDirty: boolean; reason?: string }> = {};
        for (const [name, status] of dirtyStatus) {
          dirty[name] = status;
        }

        return Response.json({ dirty });
      }),
    },

    // GET /api/infra/aws-lambdas - List AWS Lambda functions for current environment
    "/api/infra/aws-lambdas": {
      GET: handler(async (req: Request) => {
        const currentEnv = await ctx.configService.getCurrentEnvironment();

        if (!currentEnv) {
          return Response.json({
            lambdas: [],
            message: "No environment selected",
          });
        }

        // Check for force refresh query param
        const url = new URL(req.url);
        const forceRefresh = url.searchParams.get("refresh") === "true";

        // Cache key for AWS lambdas
        const cacheKey = `aws-lambdas-${currentEnv}`;

        // Check cache first (unless force refresh)
        let lambdas: Awaited<ReturnType<typeof infraService.listAwsLambdas>>;
        const cached = ctx.cacheService.get<typeof lambdas>(cacheKey);
        const cacheInfo = ctx.cacheService.getCacheInfo(cacheKey);

        if (!forceRefresh && cached && !ctx.cacheService.isExpired(cacheKey)) {
          lambdas = cached.data;
        } else {
          // Fetch from AWS
          lambdas = await infraService.listAwsLambdas(currentEnv);
          // Cache for 10 minutes
          ctx.cacheService.set(cacheKey, lambdas, 10);
        }

        // Also get local lambdas for mapping
        const selectedRepo = ctx.cacheService.getSelectedRepo();
        let localLambdas: string[] = [];

        if (selectedRepo) {
          const paths = infraService.getInfraPaths(selectedRepo.path);
          if (paths) {
            const discovered = await infraService.discoverLambdas(paths.backendPath);
            localLambdas = discovered.map((l) => l.name);
          }
        }

        // Match local names to AWS lambdas using the new matching method
        const lambdasWithLocalNames = lambdas.map((lambda) => ({
          ...lambda,
          localName: infraService.findMatchingLocalName(lambda.functionName, localLambdas),
        }));

        return Response.json({
          lambdas: lambdasWithLocalNames,
          environment: currentEnv,
          localLambdas,
          cached: !forceRefresh && cached && !ctx.cacheService.isExpired(cacheKey),
          cachedAt: cacheInfo?.cachedAt?.toISOString() || null,
        });
      }),
    },

    // POST /api/infra/aws-lambdas/invalidate - Invalidate AWS lambdas cache
    "/api/infra/aws-lambdas/invalidate": {
      POST: handler(async () => {
        const currentEnv = await ctx.configService.getCurrentEnvironment();
        if (currentEnv) {
          ctx.cacheService.invalidate(`aws-lambdas-${currentEnv}`);
        }
        return Response.json({ success: true });
      }),
    },

    // GET /api/infra/aws-lambdas/:name - Get details for a specific Lambda function
    "/api/infra/aws-lambdas/:name": {
      GET: handler(async (req: Request) => {
        const functionName = decodeURIComponent((req as any).params.name);
        const details = await infraService.getAwsLambdaDetails(functionName);

        if (!details) {
          return errorResponse("Lambda function not found", 404);
        }

        // Add AWS Console URLs
        return Response.json({
          ...details,
          awsConsoleUrl: infraService.getLambdaConsoleUrl(functionName),
          awsLogsUrl: infraService.getLambdaLogsConsoleUrl(functionName),
          region: infraService.getRegion(),
        });
      }),
    },

    // GET /api/infra/frontend/env - Read the frontend .env file
    "/api/infra/frontend/env": {
      GET: handler(async () => {
        const selectedRepo = ctx.cacheService.getSelectedRepo();
        const repoPath = selectedRepo?.path;
        console.log("Selected repo:", selectedRepo?.name, "path:", repoPath);

        if (!repoPath) {
          return errorResponse("No repository selected", 400);
        }

        const envPath = `${repoPath}/clients/web/.env`;
        console.log("Looking for .env at:", envPath);

        // Try to read the file directly - if it fails, it doesn't exist
        try {
          const file = Bun.file(envPath);
          const content = await file.text();
          console.log("File read successfully, length:", content.length);

          return Response.json({
            exists: true,
            content,
            path: envPath,
          });
        } catch (readError) {
          console.log("Could not read file:", readError);
          return Response.json({
            exists: false,
            content: "",
            path: envPath,
          });
        }
      }),
      PUT: handler(async (req: Request) => {
        const selectedRepo = ctx.cacheService.getSelectedRepo();
        const repoPath = selectedRepo?.path;
        if (!repoPath) {
          return errorResponse("No repository selected", 400);
        }

        const body = (await req.json()) as { content: string };
        const envPath = `${repoPath}/clients/web/.env`;

        await Bun.write(envPath, body.content);

        return Response.json({
          success: true,
          path: envPath,
        });
      }),
    },

    // GET /api/infra/frontend/appsync - Get AppSync URL for current environment
    "/api/infra/frontend/appsync": {
      GET: handler(async () => {
        const currentEnv = await ctx.configService.getCurrentEnvironment();

        // Get all AppSync APIs
        const apis = await infraService.listAppSyncApis();

        // Get the URL for the current environment if one is selected
        let currentUrl: string | null = null;
        if (currentEnv) {
          currentUrl = await infraService.getAppSyncUrl(currentEnv);
        }

        return Response.json({
          currentEnvironment: currentEnv,
          currentUrl,
          apis,
        });
      }),
    },

    // GET /api/infra/frontend/generate-env - Generate .env content for current environment
    "/api/infra/frontend/generate-env": {
      GET: handler(async () => {
        const currentEnv = await ctx.configService.getCurrentEnvironment();
        const stage = await ctx.configService.getInfraStage();

        if (!currentEnv) {
          return errorResponse("No environment selected", 400);
        }

        // Get the AppSync URL for this environment
        const appSyncUrl = await infraService.getAppSyncUrl(currentEnv);

        // Generate the .env content
        const lines = [
          `REACT_APP_STAGE=${stage}`,
          `REACT_APP_SUFFIX=${currentEnv}`,
          `NODE_OPTIONS=--max_old_space_size=8192`,
          `BROWSER=none`,
          `REACT_APP_APPSYNC_URL=${appSyncUrl || "# Could not find AppSync URL for this environment"}`,
        ];

        return Response.json({
          content: lines.join("\n"),
          environment: currentEnv,
          stage,
          appSyncUrl,
        });
      }),
    },
  };
}
