import index from "./index.html";
import { ConfigService } from "../services/configService";
import { JiraService } from "../services/jiraService";
import { AzureDevOpsService } from "../services/azureDevOpsService";
import { LinkingService } from "../services/linkingService";
import { CacheService } from "../services/cacheService";
import { NotesService } from "../services/notesService";
import { JobService } from "../services/jobService";
import { createApiRoutes, CACHE_KEY_TICKETS, CACHE_KEY_PRS, CACHE_KEY_DASHBOARD } from "./api";
import type { ApiContext, Services, ValidatedJiraConfig } from "./api";

export async function startUIServer(port: number) {
  const configService = new ConfigService();
  const cacheService = new CacheService();
  const jobService = new JobService();
  const uiConfig = await configService.getUIConfig();
  const notesService = new NotesService({ notesDir: uiConfig?.notesDir });

  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRefreshTime = Date.now();
  let cachedServices: Services | null = null;

  // Helper to get services (with config validation and caching)
  async function getServices(): Promise<Services> {
    if (cachedServices) return cachedServices;

    const jiraConfig = await configService.getJiraConfig();
    const azureConfig = await configService.getAzureDevOpsConfig();

    if (!jiraConfig?.host || !jiraConfig?.email || !jiraConfig?.apiToken) {
      throw new Error("JIRA not configured. Run 'bud jira config' first.");
    }

    if (
      !azureConfig?.organization ||
      !azureConfig?.project ||
      !azureConfig?.token ||
      !azureConfig?.repositoryId
    ) {
      throw new Error("Azure DevOps not configured. Run 'bud pr config' first.");
    }

    const validatedJiraConfig: ValidatedJiraConfig = {
      host: jiraConfig.host,
      email: jiraConfig.email,
      apiToken: jiraConfig.apiToken,
      boardId: jiraConfig.boardId,
    };

    const validatedAzureConfig = {
      organization: azureConfig.organization,
      project: azureConfig.project,
      token: azureConfig.token,
      repositoryId: azureConfig.repositoryId,
    };

    const jiraService = new JiraService(validatedJiraConfig);
    const azureDevOpsService = new AzureDevOpsService(validatedAzureConfig);
    const linkingService = new LinkingService(jiraService, azureDevOpsService);

    cachedServices = { jiraService, azureDevOpsService, linkingService, jiraConfig: validatedJiraConfig };
    return cachedServices;
  }

  // Invalidate the cached services (e.g., after settings change)
  function invalidateServiceCache() {
    cachedServices = null;
  }

  // Check if services are configured
  async function isConfigured(): Promise<boolean> {
    const jiraConfig = await configService.getJiraConfig();
    const azureConfig = await configService.getAzureDevOpsConfig();

    const jiraConfigured = !!(jiraConfig?.host && jiraConfig?.email && jiraConfig?.apiToken);
    const azureConfigured = !!(
      azureConfig?.organization &&
      azureConfig?.project &&
      azureConfig?.token &&
      azureConfig?.repositoryId
    );

    return jiraConfigured && azureConfigured;
  }

  // Refresh cache data
  async function refreshCache() {
    // Skip refresh if not configured yet
    if (!(await isConfigured())) {
      console.log("[Cache] Skipping refresh - not configured yet (run setup wizard)");
      return;
    }

    try {
      console.log("[Cache] Refreshing data...");
      const { linkingService, jiraConfig, jiraService, azureDevOpsService } = await getServices();

      // Fetch fresh data
      const tickets = await linkingService.getTicketsWithPRs();
      const prs = await linkingService.getPRsWithTickets();

      // Store in cache
      const pollIntervalMinutes = await configService.getPollIntervalMinutes();
      cacheService.set(CACHE_KEY_TICKETS, { tickets, jiraHost: jiraConfig.host }, pollIntervalMinutes);
      cacheService.set(CACHE_KEY_PRS, { prs, jiraHost: jiraConfig.host }, pollIntervalMinutes);

      // Also refresh dashboard data
      try {
        const dashboardData = await fetchDashboardData(jiraService, azureDevOpsService, jiraConfig.host);
        cacheService.set(CACHE_KEY_DASHBOARD, dashboardData, pollIntervalMinutes);
        console.log("[Cache] Dashboard data refreshed");
      } catch (dashErr) {
        console.error("[Cache] Error refreshing dashboard:", dashErr);
      }

      lastRefreshTime = Date.now();
      console.log("[Cache] Data refreshed successfully");
    } catch (error) {
      console.error("[Cache] Error refreshing data:", error);
    }
  }

  // Fetch dashboard data (shared between cache refresh and API)
  async function fetchDashboardData(jiraService: any, azureDevOpsService: any, jiraHost: string) {
    // Fetch base data in parallel
    const [myIssues, myPRs, prsToReview, allActivePRs] = await Promise.all([
      jiraService.getMyIssues().catch(() => []),
      azureDevOpsService.getMyPullRequests().catch(() => []),
      azureDevOpsService.getPRsToReview().catch(() => []),
      azureDevOpsService.getActivePullRequests().catch(() => []),
    ]);

    // Get current user ID for filtering
    const connectionData = await azureDevOpsService.request(
      `https://dev.azure.com/${azureDevOpsService.organization}/_apis/connectionData?api-version=7.0-preview`
    ).catch(() => ({ authenticatedUser: { id: null } }));
    const currentUserId = connectionData.authenticatedUser?.id;

    // Failed Builds - Check my PRs for failed checks
    const failedBuilds: any[] = [];
    for (const pr of myPRs) {
      try {
        const checks = await azureDevOpsService.getPRChecks(pr.pullRequestId);
        const hasFailed = checks.some((c: any) => c.status === "rejected" || c.status === "broken");
        if (hasFailed) {
          failedBuilds.push({ ...pr, _failedChecks: checks.filter((c: any) => c.status === "rejected" || c.status === "broken") });
        }
      } catch {
        // Skip if we can't get checks
      }
    }

    // Stale PRs - PRs not updated in 7+ days
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const stalePRs = allActivePRs.filter((pr: any) => {
      const creationDate = new Date(pr.creationDate).getTime();
      return creationDate < sevenDaysAgo;
    });

    // Blocked/Waiting - My PRs where someone requested changes (vote = -5)
    const blockedPRs = myPRs.filter((pr: any) => {
      const reviewers = pr.reviewers || [];
      return reviewers.some((r: any) => r.vote === -5 && !r.isContainer);
    });

    // Team Overview - Other people's PRs (excluding mine)
    const teamPRs = allActivePRs.filter((pr: any) => {
      const creatorId = pr.createdBy?.id;
      return creatorId !== currentUserId;
    });

    // Recent Activity - Get comments from my PRs (last 5 PRs max)
    const recentActivity: any[] = [];
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

    return {
      myIssues,
      myPRs,
      prsToReview,
      failedBuilds,
      stalePRs,
      blockedPRs,
      teamPRs,
      recentActivity: recentActivity.slice(0, 10),
      jiraHost,
      timestamp: Date.now(),
    };
  }

  // Start polling
  async function startPolling() {
    stopPolling();
    const pollIntervalMinutes = await configService.getPollIntervalMinutes();
    const intervalMs = pollIntervalMinutes * 60 * 1000;

    console.log(`[Cache] Starting polling every ${pollIntervalMinutes} minutes`);

    pollTimer = setInterval(async () => {
      await refreshCache();
    }, intervalMs);
  }

  // Stop polling
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // Restart polling (e.g., after manual refresh or settings change)
  async function restartPolling() {
    stopPolling();
    await startPolling();
  }

  // Refresh just dashboard data (for background updates)
  async function refreshDashboard() {
    try {
      const { jiraService, azureDevOpsService, jiraConfig } = await getServices();
      const dashboardData = await fetchDashboardData(jiraService, azureDevOpsService, jiraConfig.host);
      const pollIntervalMinutes = await configService.getPollIntervalMinutes();
      cacheService.set(CACHE_KEY_DASHBOARD, dashboardData, pollIntervalMinutes);
      return dashboardData;
    } catch (error) {
      console.error("[Cache] Error refreshing dashboard:", error);
      throw error;
    }
  }

  // Create API context for route handlers
  const apiContext: ApiContext = {
    configService,
    cacheService,
    notesService,
    jobService,
    getServices,
    refreshCache,
    refreshDashboard,
    restartPolling,
    getLastRefreshTime: () => lastRefreshTime,
    invalidateServiceCache,
  };

  // Initial data load
  await refreshCache();
  await startPolling();

  const server = Bun.serve({
    port,
    idleTimeout: 0, // Disable timeout for long-running SSE connections (CDK deploys, builds)
    routes: {
      // Serve React app for all non-API routes
      "/": index,
      "/dashboard": index,
      "/stats": index,
      "/tickets": index,
      "/tickets/*": index,  // Detail pages like /tickets/PROJ-123
      "/prs": index,
      "/prs/*": index,      // Detail pages like /prs/456
      "/git": index,
      "/infra": index,
      "/appsync": index,
      "/jobs": index,
      "/ctest": index,
      "/ai-docs": index,
      "/ai-test": index,
      "/settings": index,

      // API routes from modules
      ...createApiRoutes(apiContext),
    },
    development: {
      hmr: true,
      console: true,
    },
  });

  console.log(`\nBuddy UI running at http://localhost:${server.port}`);
  console.log("Press Ctrl+C to stop\n");

  // Keep the process running
  return server;
}
