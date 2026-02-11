import type { ApiContext } from "./context";
import { handler } from "./helpers";

interface MonthlyData {
  month: string; // "2024-01" format
  label: string; // "Jan 2024" format
  ticketsCompleted: number;
  prsCreated: number;
  prsMerged: number;
}

interface StatsData {
  summary: {
    totalTicketsCompleted: number;
    totalPRsCreated: number;
    totalPRsMerged: number;
    periodStart: string;
    periodEnd: string;
  };
  monthly: MonthlyData[];
  cachedAt: number;
}

// Cache stats for 1 hour since this is historical data
const STATS_CACHE_TTL = 60 * 60 * 1000; // 1 hour
let statsCache: { data: StatsData; timestamp: number } | null = null;

export function statsRoutes(ctx: ApiContext) {
  return {
    // GET /api/stats - Get user stats for the past year
    "/api/stats": {
      GET: handler(async (req: Request) => {
        const url = new URL(req.url);
        const forceRefresh = url.searchParams.get("refresh") === "true";

        // Check cache
        if (!forceRefresh && statsCache && Date.now() - statsCache.timestamp < STATS_CACHE_TTL) {
          return Response.json(statsCache.data);
        }

        const { jiraService, azureDevOpsService } = await ctx.getServices();

        // Calculate date range (past 12 months)
        const now = new Date();
        const oneYearAgo = new Date(now);
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        oneYearAgo.setDate(1); // Start of that month
        oneYearAgo.setHours(0, 0, 0, 0);

        // Initialize monthly buckets
        const monthlyMap = new Map<string, MonthlyData>();
        const months: string[] = [];

        for (let d = new Date(oneYearAgo); d <= now; d.setMonth(d.getMonth() + 1)) {
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
          const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
          months.push(key);
          monthlyMap.set(key, {
            month: key,
            label,
            ticketsCompleted: 0,
            prsCreated: 0,
            prsMerged: 0,
          });
        }

        // Fetch completed tickets from JIRA
        // Using JQL to find issues resolved in the past year assigned to current user
        // Use "resolution IS NOT EMPTY" to catch any resolved ticket regardless of status name
        // Use "resolutiondate" which is the standard JQL field for when a ticket was resolved
        const jqlCompleted = `assignee was currentUser() AND resolution IS NOT EMPTY AND resolutiondate >= -365d ORDER BY resolutiondate DESC`;
        let completedTickets: any[] = [];
        try {
          completedTickets = await jiraService.searchIssues(jqlCompleted, 500);
        } catch (err) {
          console.error("Failed to fetch completed tickets:", err);
          // Try alternative JQL if the first one fails
          try {
            const jqlAlt = `assignee = currentUser() AND status = Done AND updated >= -365d ORDER BY updated DESC`;
            completedTickets = await jiraService.searchIssues(jqlAlt, 500);
          } catch (altErr) {
            console.error("Alternative JQL also failed:", altErr);
          }
        }

        // Count tickets by month based on resolution date
        for (const ticket of completedTickets) {
          const resolvedDate = ticket.fields.resolutiondate;
          if (resolvedDate) {
            const d = new Date(resolvedDate);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            const monthData = monthlyMap.get(key);
            if (monthData) {
              monthData.ticketsCompleted++;
            }
          }
        }

        // Fetch all PRs created by user (including completed ones)
        let allPRs: any[] = [];
        try {
          // Get completed PRs
          const completedPRs = await azureDevOpsService.getCompletedPullRequests(365);
          // Get active PRs
          const activePRs = await azureDevOpsService.getMyPullRequests();
          // Combine and dedupe
          const prMap = new Map<number, any>();
          for (const pr of [...completedPRs, ...activePRs]) {
            prMap.set(pr.pullRequestId, pr);
          }
          allPRs = Array.from(prMap.values());
        } catch (err) {
          console.error("Failed to fetch PRs:", err);
        }

        // Count PRs by month
        for (const pr of allPRs) {
          const createdDate = new Date(pr.creationDate);
          const createdKey = `${createdDate.getFullYear()}-${String(createdDate.getMonth() + 1).padStart(2, "0")}`;
          const monthData = monthlyMap.get(createdKey);
          if (monthData) {
            monthData.prsCreated++;
          }

          // Count merged PRs
          if (pr.status === "completed" && pr.closedDate) {
            const closedDate = new Date(pr.closedDate);
            const closedKey = `${closedDate.getFullYear()}-${String(closedDate.getMonth() + 1).padStart(2, "0")}`;
            const closedMonthData = monthlyMap.get(closedKey);
            if (closedMonthData) {
              closedMonthData.prsMerged++;
            }
          }
        }

        // Build response
        const monthly = months.map((key) => monthlyMap.get(key)!);
        const summary = {
          totalTicketsCompleted: completedTickets.length,
          totalPRsCreated: allPRs.length,
          totalPRsMerged: allPRs.filter((pr) => pr.status === "completed").length,
          periodStart: oneYearAgo.toISOString(),
          periodEnd: now.toISOString(),
          // Debug info
          _debug: {
            ticketQuery: "assignee was currentUser() AND resolution IS NOT EMPTY AND resolutiondate >= -365d",
            ticketsFound: completedTickets.length,
            prsFound: allPRs.length,
          },
        };

        const statsData: StatsData = {
          summary,
          monthly,
          cachedAt: Date.now(),
        };

        // Update cache
        statsCache = { data: statsData, timestamp: Date.now() };

        return Response.json(statsData);
      }),
    },

    // GET /api/stats/cache-info - Get cache status
    "/api/stats/cache-info": {
      GET: handler(async () => {
        if (!statsCache) {
          return Response.json({ cached: false });
        }

        const age = Date.now() - statsCache.timestamp;
        const ttlRemaining = Math.max(0, STATS_CACHE_TTL - age);

        return Response.json({
          cached: true,
          cachedAt: new Date(statsCache.timestamp).toISOString(),
          ageMinutes: Math.floor(age / 60000),
          ttlRemainingMinutes: Math.floor(ttlRemaining / 60000),
        });
      }),
    },
  };
}
