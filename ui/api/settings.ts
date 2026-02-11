import type { ApiContext } from "./context";
import { CACHE_KEY_TICKETS, CACHE_KEY_PRS } from "./context";
import { handler } from "./helpers";

export function settingsRoutes(ctx: ApiContext) {
  return {
    // GET /api/status - Health check / config status
    "/api/status": {
      GET: handler(async () => {
        const jiraConfig = await ctx.configService.getJiraConfig();
        const azureConfig = await ctx.configService.getAzureDevOpsConfig();

        const jiraConfigured = !!(jiraConfig?.host && jiraConfig?.email && jiraConfig?.apiToken);
        const azureConfigured = !!(
          azureConfig?.organization &&
          azureConfig?.project &&
          azureConfig?.token &&
          azureConfig?.repositoryId
        );

        return Response.json({
          configured: jiraConfigured && azureConfigured,
          jira: {
            configured: jiraConfigured,
            hasHost: !!jiraConfig?.host,
            hasEmail: !!jiraConfig?.email,
            hasToken: !!jiraConfig?.apiToken,
            // Return existing values for pre-filling (not the token)
            host: jiraConfig?.host || "",
            email: jiraConfig?.email || "",
          },
          azure: {
            configured: azureConfigured,
            hasOrganization: !!azureConfig?.organization,
            hasProject: !!azureConfig?.project,
            hasToken: !!azureConfig?.token,
            hasRepositoryId: !!azureConfig?.repositoryId,
            // Return existing values for pre-filling (not the token)
            organization: azureConfig?.organization || "",
            project: azureConfig?.project || "",
            repositoryId: azureConfig?.repositoryId || "",
          },
        });
      }),
    },

    // PUT /api/setup - Initial setup wizard config save
    "/api/setup": {
      PUT: handler(async (req: Request) => {
        const body = (await req.json()) as {
          jira?: {
            host?: string;
            email?: string;
            apiToken?: string;
          };
          azure?: {
            organization?: string;
            project?: string;
            token?: string;
            repositoryId?: string;
          };
        };

        if (body.jira) {
          await ctx.configService.setJiraConfig(body.jira);
        }

        if (body.azure) {
          await ctx.configService.setAzureDevOpsConfig(body.azure);
        }

        // Invalidate service cache since config changed
        ctx.invalidateServiceCache();

        return Response.json({ success: true });
      }),
    },

    // GET/PUT /api/settings - Settings management
    "/api/settings": {
      GET: handler(async () => {
        const pollIntervalMinutes = await ctx.configService.getPollIntervalMinutes();
        const protectedEnvironments = await ctx.configService.getProtectedEnvironments();
        const lastUpdate = ctx.cacheService.getLastUpdateTime();
        return Response.json({
          settings: { pollIntervalMinutes, protectedEnvironments },
          lastUpdate: lastUpdate?.toISOString() || null,
          nextRefresh: lastUpdate
            ? new Date(lastUpdate.getTime() + pollIntervalMinutes * 60 * 1000).toISOString()
            : null,
        });
      }),
      PUT: handler(async (req: Request) => {
        const body = (await req.json()) as {
          pollIntervalMinutes?: number;
          protectedEnvironments?: string[];
        };

        if (body.pollIntervalMinutes !== undefined) {
          await ctx.configService.setPollIntervalMinutes(body.pollIntervalMinutes);
        }
        if (body.protectedEnvironments !== undefined) {
          await ctx.configService.setProtectedEnvironments(body.protectedEnvironments);
        }

        // Restart polling with new interval
        await ctx.restartPolling();

        // Invalidate service cache since settings changed
        ctx.invalidateServiceCache();

        const pollIntervalMinutes = await ctx.configService.getPollIntervalMinutes();
        const protectedEnvironments = await ctx.configService.getProtectedEnvironments();
        return Response.json({ settings: { pollIntervalMinutes, protectedEnvironments } });
      }),
    },

    // POST /api/refresh - Force refresh cache
    "/api/refresh": {
      POST: handler(async () => {
        await ctx.refreshCache();
        await ctx.restartPolling(); // Reset poll timer

        const pollIntervalMinutes = await ctx.configService.getPollIntervalMinutes();
        return Response.json({
          success: true,
          lastUpdate: new Date().toISOString(),
          nextRefresh: new Date(Date.now() + pollIntervalMinutes * 60 * 1000).toISOString(),
        });
      }),
    },

    // GET /api/cache/info - Cache information
    "/api/cache/info": {
      GET: handler(async () => {
        const ticketsCache = ctx.cacheService.getCacheInfo(CACHE_KEY_TICKETS);
        const prsCache = ctx.cacheService.getCacheInfo(CACHE_KEY_PRS);
        const pollIntervalMinutes = await ctx.configService.getPollIntervalMinutes();

        return Response.json({
          tickets: ticketsCache,
          prs: prsCache,
          pollIntervalMinutes,
          lastRefreshTime: new Date(ctx.getLastRefreshTime()).toISOString(),
        });
      }),
    },
  };
}
