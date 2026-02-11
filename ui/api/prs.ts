import type { ApiContext } from "./context";
import { CACHE_KEY_PRS } from "./context";
import { handler, errorResponse } from "./helpers";

export function prsRoutes(ctx: ApiContext) {
  return {
    // GET /api/prs/search - Search PRs by title, branch, or author
    "/api/prs/search": {
      GET: handler(async (req: Request) => {
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
      }),
    },

    // GET /api/prs - Get all PRs with linked tickets (from cache)
    "/api/prs": {
      GET: handler(async () => {
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
      }),
    },

    // GET /api/prs/:id - Get single PR
    "/api/prs/:id": {
      GET: handler(async (req: Request) => {
        const { azureDevOpsService, jiraConfig } = await ctx.getServices();
        const pr = await azureDevOpsService.getPullRequest(parseInt((req as any).params.id));
        return Response.json({ pr, jiraHost: jiraConfig.host });
      }),
    },

    // GET /api/prs/:id/statuses - Get PR statuses (policy evaluations)
    "/api/prs/:id/statuses": {
      GET: handler(async (req: Request) => {
        const { azureDevOpsService } = await ctx.getServices();
        const prId = parseInt((req as any).params.id);

        // Get policy evaluations (build status, required reviewers, etc.)
        const checks = await azureDevOpsService.getPRChecks(prId);

        // Also get custom statuses if any
        const customStatuses = await azureDevOpsService.getPullRequestStatuses(prId);

        return Response.json({
          checks,
          statuses: customStatuses,
        });
      }),
    },

    // PUT /api/prs/:id/description - Update PR description
    "/api/prs/:id/description": {
      PUT: handler(async (req: Request) => {
        const { azureDevOpsService } = await ctx.getServices();
        const body = await req.json();
        const { description } = body;

        if (typeof description !== "string") {
          return errorResponse("Description is required", 400);
        }

        const pr = await azureDevOpsService.updatePullRequestDescription(
          parseInt((req as any).params.id),
          description
        );

        // Invalidate PR cache since description changed
        ctx.cacheService.invalidate(CACHE_KEY_PRS);

        return Response.json({ success: true, pr });
      }),
    },

    // GET /api/prs/:id/comments - Get PR comments/threads
    "/api/prs/:id/comments": {
      GET: handler(async (req: Request) => {
        const { azureDevOpsService } = await ctx.getServices();
        const prId = parseInt((req as any).params.id);
        const threads = await azureDevOpsService.getPRThreads(prId);

        // Add thread URLs for linking to Azure DevOps
        const threadsWithUrls = threads.map(thread => ({
          ...thread,
          webUrl: azureDevOpsService.getPRThreadUrl(prId, thread.id),
        }));

        return Response.json({ threads: threadsWithUrls, prId });
      }),
    },

    // POST /api/prs/:id/reviewers - Add a reviewer to PR
    "/api/prs/:id/reviewers": {
      POST: handler(async (req: Request) => {
        const { azureDevOpsService } = await ctx.getServices();
        const prId = parseInt((req as any).params.id);
        const body = (await req.json()) as { reviewerId: string; isRequired?: boolean };

        if (!body.reviewerId) {
          return errorResponse("reviewerId is required", 400);
        }

        const reviewer = await azureDevOpsService.addReviewer(prId, body.reviewerId, body.isRequired || false);

        // Get updated PR
        const pr = await azureDevOpsService.getPullRequest(prId);

        // Invalidate cache since reviewers changed
        ctx.cacheService.invalidate(CACHE_KEY_PRS);

        return Response.json({ success: true, reviewer, pr });
      }),
    },

    // POST /api/prs/:id/reviewers/self - Add current user as optional reviewer
    "/api/prs/:id/reviewers/self": {
      POST: handler(async (req: Request) => {
        const { azureDevOpsService } = await ctx.getServices();
        const prId = parseInt((req as any).params.id);

        const result = await azureDevOpsService.addSelfAsReviewer(prId);

        // Get updated PR
        const pr = await azureDevOpsService.getPullRequest(prId);

        // Invalidate cache since reviewers changed
        ctx.cacheService.invalidate(CACHE_KEY_PRS);

        return Response.json({
          success: true,
          reviewer: result.reviewer,
          displayName: result.displayName,
          pr,
        });
      }),
      DELETE: handler(async (req: Request) => {
        const { azureDevOpsService } = await ctx.getServices();
        const prId = parseInt((req as any).params.id);

        // Get current user's ID
        const currentUser = await azureDevOpsService.getCurrentUser();

        // Remove self as reviewer
        await azureDevOpsService.removeReviewer(prId, currentUser.id);

        // Get updated PR
        const pr = await azureDevOpsService.getPullRequest(prId);

        // Invalidate cache since reviewers changed
        ctx.cacheService.invalidate(CACHE_KEY_PRS);

        return Response.json({
          success: true,
          pr,
        });
      }),
    },

    // DELETE /api/prs/:id/reviewers/:reviewerId - Remove a reviewer from PR
    "/api/prs/:id/reviewers/:reviewerId": {
      DELETE: handler(async (req: Request) => {
        const { azureDevOpsService } = await ctx.getServices();
        const prId = parseInt((req as any).params.id);
        const reviewerId = (req as any).params.reviewerId;

        await azureDevOpsService.removeReviewer(prId, reviewerId);

        // Get updated PR
        const pr = await azureDevOpsService.getPullRequest(prId);

        // Invalidate cache since reviewers changed
        ctx.cacheService.invalidate(CACHE_KEY_PRS);

        return Response.json({ success: true, pr });
      }),
    },

    // GET /api/prs/users/search - Search for users to add as reviewers
    "/api/prs/users/search": {
      GET: handler(async (req: Request) => {
        const url = new URL(req.url);
        const query = url.searchParams.get("q") || "";

        if (!query.trim() || query.length < 2) {
          return Response.json({ users: [], error: "Query must be at least 2 characters" }, { status: 400 });
        }

        const { azureDevOpsService } = await ctx.getServices();
        const users = await azureDevOpsService.searchUsers(query);

        return Response.json({ users });
      }),
    },
  };
}
