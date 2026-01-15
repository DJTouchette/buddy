import type { ApiContext } from "./context";
import { CACHE_KEY_PRS } from "./context";

export function prsRoutes(ctx: ApiContext) {
  return {
    // GET /api/prs/search - Search PRs by title, branch, or author
    "/api/prs/search": {
      GET: async (req: Request) => {
        try {
          const url = new URL(req.url);
          const query = url.searchParams.get("q") || "";
          const status = url.searchParams.get("status") || "all"; // active, completed, abandoned, all

          if (!query.trim()) {
            return Response.json({ prs: [], error: "Query is required" }, { status: 400 });
          }

          const { azureDevOpsService, jiraConfig } = await ctx.getServices();
          const queryLower = query.toLowerCase().trim();

          // Fetch PRs based on status filter
          let prs: Awaited<ReturnType<typeof azureDevOpsService.getActivePullRequests>> = [];

          if (status === "active" || status === "all") {
            const activePrs = await azureDevOpsService.getActivePullRequests();
            prs.push(...activePrs);
          }

          if (status === "completed" || status === "all") {
            // Fetch completed PRs (Azure DevOps API)
            const response = await fetch(
              `https://dev.azure.com/${(azureDevOpsService as any).organization}/${(azureDevOpsService as any).project}/_apis/git/repositories/${(azureDevOpsService as any).repositoryId}/pullrequests?searchCriteria.status=completed&$top=100&api-version=7.0`,
              {
                headers: {
                  Authorization: (azureDevOpsService as any).authHeader,
                  "Content-Type": "application/json",
                },
              }
            );
            if (response.ok) {
              const data = await response.json();
              prs.push(...(data.value || []));
            }
          }

          // Filter by query (search in title, source branch, author)
          const filteredPrs = prs.filter((pr) => {
            const title = pr.title.toLowerCase();
            const source = pr.sourceRefName.toLowerCase();
            const author = pr.createdBy.displayName.toLowerCase();
            const prId = String(pr.pullRequestId);

            return (
              title.includes(queryLower) ||
              source.includes(queryLower) ||
              author.includes(queryLower) ||
              prId.includes(queryLower)
            );
          });

          // Remove duplicates and sort by ID desc
          const uniquePrs = Array.from(
            new Map(filteredPrs.map((pr) => [pr.pullRequestId, pr])).values()
          ).sort((a, b) => b.pullRequestId - a.pullRequestId);

          return Response.json({
            prs: uniquePrs.slice(0, 50), // Limit to 50 results
            jiraHost: jiraConfig.host,
            query,
            status,
          });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/prs - Get all PRs with linked tickets (from cache)
    "/api/prs": {
      GET: async () => {
        try {
          // Try to get from cache first
          const cached = ctx.cacheService.get<{ prs: any[]; jiraHost: string }>(CACHE_KEY_PRS);

          if (cached) {
            const cacheInfo = ctx.cacheService.getCacheInfo(CACHE_KEY_PRS);
            return Response.json({
              ...cached.data,
              _cache: {
                cachedAt: cached.cachedAt,
                expiresAt: cached.expiresAt,
                isExpired: cacheInfo?.isExpired,
              },
            });
          }

          // Fallback to fresh fetch if cache is empty
          const { linkingService, jiraConfig } = await ctx.getServices();
          const prs = await linkingService.getPRsWithTickets();
          const data = { prs, jiraHost: jiraConfig.host };

          // Store in cache
          ctx.cacheService.set(CACHE_KEY_PRS, data);

          return Response.json(data);
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/prs/:id - Get single PR
    "/api/prs/:id": {
      GET: async (req: Request & { params: { id: string } }) => {
        try {
          const { azureDevOpsService, jiraConfig } = await ctx.getServices();
          const pr = await azureDevOpsService.getPullRequest(parseInt(req.params.id));
          return Response.json({ pr, jiraHost: jiraConfig.host });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/prs/:id/statuses - Get PR statuses
    "/api/prs/:id/statuses": {
      GET: async (req: Request & { params: { id: string } }) => {
        try {
          const { azureDevOpsService } = await ctx.getServices();
          const statuses = await azureDevOpsService.getPullRequestStatuses(parseInt(req.params.id));
          return Response.json({ statuses });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },
  };
}
