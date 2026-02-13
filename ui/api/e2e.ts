import type { ApiContext } from "./context";
import { handler, errorResponse } from "./helpers";

export function e2eRoutes(ctx: ApiContext) {
  return {
    // Debug: list all pipeline definitions to find the right name
    "/api/e2e/pipelines": {
      GET: handler(async () => {
        const { azureDevOpsService } = await ctx.getServices();
        const definitions = await azureDevOpsService.getPipelineDefinitions();
        return Response.json({ definitions: definitions.map(d => ({ id: d.id, name: d.name })) });
      }),
    },

    "/api/e2e/runs": {
      GET: handler(async (req: Request) => {
        const { azureDevOpsService } = await ctx.getServices();

        // Find the e2e pipeline definition — fetch all and match by name containing "e2e"
        const allDefinitions = await azureDevOpsService.getPipelineDefinitions();
        const e2eDef = allDefinitions.find(d => d.name.toLowerCase().includes("e2e"));
        if (!e2eDef) {
          return Response.json({
            runs: [],
            error: "No e2e pipeline definition found",
            availablePipelines: allDefinitions.map(d => ({ id: d.id, name: d.name })),
          });
        }

        const definitionId = e2eDef.id;

        // Get recent builds for this pipeline
        const builds = await azureDevOpsService.getBuildsByDefinition(definitionId, 20);

        // Get test runs for each build
        const runs: any[] = [];
        for (const build of builds) {
          const buildUri = `vstfs:///Build/Build/${build.id}`;
          const testRuns = await azureDevOpsService.getTestRuns(buildUri);
          for (const run of testRuns) {
            runs.push({
              ...run,
              buildId: build.id,
              buildNumber: build.buildNumber,
              buildStatus: build.status,
              buildResult: build.result,
              buildUrl: azureDevOpsService.getBuildUrl(build.id),
            });
          }
        }

        // Sort by most recent first
        runs.sort((a, b) => new Date(b.startedDate).getTime() - new Date(a.startedDate).getTime());

        return Response.json({ runs });
      }),
    },

    "/api/e2e/runs/:runId/results": {
      GET: handler(async (req: Request) => {
        const runId = parseInt((req as any).params.runId);
        if (isNaN(runId)) {
          return errorResponse("Invalid run ID", 400);
        }

        const { azureDevOpsService } = await ctx.getServices();
        const results = await azureDevOpsService.getTestRunResults(runId);

        return Response.json({ results });
      }),
    },
  };
}
