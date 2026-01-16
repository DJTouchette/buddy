import index from "./index.html";
import { ConfigService } from "../services/configService";
import { JiraService } from "../services/jiraService";
import { AzureDevOpsService } from "../services/azureDevOpsService";
import { LinkingService } from "../services/linkingService";
import { CacheService } from "../services/cacheService";
import { NotesService } from "../services/notesService";
import { JobService } from "../services/jobService";
import { createApiRoutes, CACHE_KEY_TICKETS, CACHE_KEY_PRS } from "./api";
import type { ApiContext, Services, ValidatedJiraConfig } from "./api";

export async function startUIServer(port: number) {
  const configService = new ConfigService();
  const cacheService = new CacheService();
  const jobService = new JobService();
  const uiConfig = await configService.getUIConfig();
  const notesService = new NotesService({ notesDir: uiConfig?.notesDir });

  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRefreshTime = Date.now();

  // Helper to get services (with config validation)
  async function getServices(): Promise<Services> {
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

    return { jiraService, azureDevOpsService, linkingService, jiraConfig: validatedJiraConfig };
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
      const { linkingService, jiraConfig } = await getServices();

      // Fetch fresh data
      const tickets = await linkingService.getTicketsWithPRs();
      const prs = await linkingService.getPRsWithTickets();

      // Store in cache
      const pollIntervalMinutes = await configService.getPollIntervalMinutes();
      cacheService.set(CACHE_KEY_TICKETS, { tickets, jiraHost: jiraConfig.host }, pollIntervalMinutes);
      cacheService.set(CACHE_KEY_PRS, { prs, jiraHost: jiraConfig.host }, pollIntervalMinutes);

      lastRefreshTime = Date.now();
      console.log("[Cache] Data refreshed successfully");
    } catch (error) {
      console.error("[Cache] Error refreshing data:", error);
    }
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

  // Create API context for route handlers
  const apiContext: ApiContext = {
    configService,
    cacheService,
    notesService,
    jobService,
    getServices,
    refreshCache,
    restartPolling,
    getLastRefreshTime: () => lastRefreshTime,
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
      "/tickets": index,
      "/tickets/*": index,  // Detail pages like /tickets/PROJ-123
      "/prs": index,
      "/prs/*": index,      // Detail pages like /prs/456
      "/git": index,
      "/infra": index,
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
