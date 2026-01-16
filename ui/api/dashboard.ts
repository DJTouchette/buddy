import type { ApiContext } from "./context";

export function dashboardRoutes(ctx: ApiContext) {
  return {
    // GET /api/dashboard/debug - Debug endpoint to check user info
    "/api/dashboard/debug": {
      GET: async () => {
        try {
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
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/dashboard - Get all dashboard data in one call
    "/api/dashboard": {
      GET: async () => {
        try {
          const { jiraService, azureDevOpsService, jiraConfig } = await ctx.getServices();

          // Fetch base data in parallel
          const [myIssues, myPRs, prsToReview, allActivePRs] = await Promise.all([
            jiraService.getMyIssues().catch(() => []),
            azureDevOpsService.getMyPullRequests().catch(() => []),
            azureDevOpsService.getPRsToReview().catch(() => []),
            azureDevOpsService.getActivePullRequests().catch(() => []),
          ]);

          // Get current user ID for filtering
          const connectionData = await (azureDevOpsService as any).request(
            `https://dev.azure.com/${(azureDevOpsService as any).organization}/_apis/connectionData?api-version=7.0-preview`
          ).catch(() => ({ authenticatedUser: { id: null } }));
          const currentUserId = connectionData.authenticatedUser?.id;

          // Failed Builds - Check my PRs for failed checks
          const failedBuilds: typeof myPRs = [];
          for (const pr of myPRs) {
            try {
              const checks = await azureDevOpsService.getPRChecks(pr.pullRequestId);
              const hasFailed = checks.some(c => c.status === "rejected" || c.status === "broken");
              if (hasFailed) {
                failedBuilds.push({ ...pr, _failedChecks: checks.filter(c => c.status === "rejected" || c.status === "broken") });
              }
            } catch {
              // Skip if we can't get checks
            }
          }

          // Stale PRs - PRs not updated in 7+ days
          const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
          const stalePRs = allActivePRs.filter(pr => {
            const creationDate = new Date((pr as any).creationDate).getTime();
            return creationDate < sevenDaysAgo;
          });

          // Blocked/Waiting - My PRs where someone requested changes (vote = -5)
          const blockedPRs = myPRs.filter(pr => {
            const reviewers = (pr as any).reviewers || [];
            return reviewers.some((r: any) => r.vote === -5 && !r.isContainer);
          });

          // Team Overview - Other people's PRs (excluding mine)
          const teamPRs = allActivePRs.filter(pr => {
            const creatorId = (pr as any).createdBy?.id;
            return creatorId !== currentUserId;
          });

          // Recent Activity - Get comments from my PRs (last 5 PRs max)
          const recentActivity: Array<{
            prId: number;
            prTitle: string;
            comment: string;
            author: string;
            date: string;
            webUrl: string;
          }> = [];

          for (const pr of myPRs.slice(0, 5)) {
            try {
              const threads = await azureDevOpsService.getPRThreads(pr.pullRequestId);
              for (const thread of threads.slice(0, 3)) {
                const firstComment = thread.comments[0];
                if (firstComment && firstComment.content) {
                  recentActivity.push({
                    prId: pr.pullRequestId,
                    prTitle: pr.title,
                    comment: firstComment.content.slice(0, 150) + (firstComment.content.length > 150 ? "..." : ""),
                    author: firstComment.author.displayName,
                    date: firstComment.publishedDate,
                    webUrl: azureDevOpsService.getPRThreadUrl(pr.pullRequestId, thread.id),
                  });
                }
              }
            } catch {
              // Skip if we can't get threads
            }
          }

          // Sort by date descending and limit
          recentActivity.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

          return Response.json({
            myIssues,
            myPRs,
            prsToReview,
            failedBuilds,
            stalePRs,
            blockedPRs,
            teamPRs,
            recentActivity: recentActivity.slice(0, 10),
            jiraHost: jiraConfig.host,
          });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/dashboard/issues - Get just the assigned issues
    "/api/dashboard/issues": {
      GET: async () => {
        try {
          const { jiraService, jiraConfig } = await ctx.getServices();
          const issues = await jiraService.getMyIssues();
          return Response.json({ issues, jiraHost: jiraConfig.host });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/dashboard/my-prs - Get PRs created by current user
    "/api/dashboard/my-prs": {
      GET: async () => {
        try {
          const { azureDevOpsService } = await ctx.getServices();
          const prs = await azureDevOpsService.getMyPullRequests();
          return Response.json({ prs });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/dashboard/to-review - Get PRs where current user is a reviewer
    "/api/dashboard/to-review": {
      GET: async () => {
        try {
          const { azureDevOpsService } = await ctx.getServices();
          const prs = await azureDevOpsService.getPRsToReview();
          return Response.json({ prs });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },
  };
}
