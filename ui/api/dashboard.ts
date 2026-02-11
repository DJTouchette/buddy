import type { ApiContext } from "./context";
import { CACHE_KEY_DASHBOARD } from "./context";
import { handler } from "./helpers";

export function dashboardRoutes(ctx: ApiContext) {
  return {
    // GET /api/dashboard/debug - Debug endpoint to check user info
    "/api/dashboard/debug": {
      GET: handler(async () => {
        const { azureDevOpsService } = await ctx.getServices();

        // Get connection data to see what we're working with
        const connectionData = await (azureDevOpsService as any).request(
          `https://dev.azure.com/${(azureDevOpsService as any).organization}/_apis/connectionData?api-version=7.0-preview`
        );

        return Response.json({
          connectionData,
          authenticatedUser: connectionData.authenticatedUser,
          userId: connectionData.authenticatedUser?.id,
        });
      }),
    },

    // GET /api/dashboard - Get all dashboard data in one call (uses cache)
    "/api/dashboard": {
      GET: handler(async (req: Request) => {
        const url = new URL(req.url);
        const forceRefresh = url.searchParams.get("refresh") === "true";

        // Check cache first (unless force refresh)
        if (!forceRefresh) {
          const cached = ctx.cacheService.get(CACHE_KEY_DASHBOARD);
          if (cached) {
            // cached.data contains the actual dashboard data
            return Response.json({ ...cached.data, fromCache: true });
          }
        }

        // No cache or force refresh - fetch fresh data
        const data = await ctx.refreshDashboard();
        return Response.json(data);
      }),
    },

    // GET /api/dashboard/issues - Get just the assigned issues
    "/api/dashboard/issues": {
      GET: handler(async () => {
        const { jiraService, jiraConfig } = await ctx.getServices();
        const issues = await jiraService.getMyIssues();
        return Response.json({ issues, jiraHost: jiraConfig.host });
      }),
    },

    // GET /api/dashboard/my-prs - Get PRs created by current user
    "/api/dashboard/my-prs": {
      GET: handler(async () => {
        const { azureDevOpsService } = await ctx.getServices();
        const prs = await azureDevOpsService.getMyPullRequests();
        return Response.json({ prs });
      }),
    },

    // GET /api/dashboard/to-review - Get PRs where current user is a reviewer
    "/api/dashboard/to-review": {
      GET: handler(async () => {
        const { azureDevOpsService } = await ctx.getServices();
        const prs = await azureDevOpsService.getPRsToReview();
        return Response.json({ prs });
      }),
    },

    // GET /api/dashboard/stream - SSE endpoint for live dashboard updates
    "/api/dashboard/stream": {
      GET: handler(async (req: Request) => {
        const REFRESH_INTERVAL = 60000; // 1 minute

        const stream = new ReadableStream({
          async start(controller) {
            let isAborted = false;

            // Send cached data immediately if available
            const cached = ctx.cacheService.get(CACHE_KEY_DASHBOARD);
            if (cached) {
              // cached.data contains the actual dashboard data
              controller.enqueue(
                new TextEncoder().encode(`data: ${JSON.stringify({ ...cached.data, fromCache: true })}\n\n`)
              );

              // Trigger background refresh
              ctx.refreshDashboard().then((freshData) => {
                if (!isAborted) {
                  controller.enqueue(
                    new TextEncoder().encode(`data: ${JSON.stringify(freshData)}\n\n`)
                  );
                }
              }).catch((err) => {
                console.error("Background dashboard refresh failed:", err);
              });
            } else {
              // No cache - fetch fresh data
              try {
                const freshData = await ctx.refreshDashboard();
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify(freshData)}\n\n`)
                );
              } catch (err) {
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`)
                );
              }
            }

            // Set up interval to send updates (every minute)
            const interval = setInterval(async () => {
              if (isAborted) {
                clearInterval(interval);
                return;
              }

              try {
                const data = await ctx.refreshDashboard();
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
                );
              } catch (err) {
                // Send error but don't close stream
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify({ error: String(err) })}\n\n`)
                );
              }
            }, REFRESH_INTERVAL);

            // Cleanup on abort
            req.signal?.addEventListener("abort", () => {
              isAborted = true;
              clearInterval(interval);
              try {
                controller.close();
              } catch {
                // Stream might already be closed
              }
            });
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      }),
    },
  };
}
