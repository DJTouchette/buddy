import type { ApiContext } from "./context";
import { CACHE_KEY_TICKETS, CACHE_KEY_PRS } from "./context";

export function settingsRoutes(ctx: ApiContext) {
  return {
    // GET /api/status - Health check / config status
    "/api/status": {
      GET: async () => {
        try {
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
        } catch (error) {
          return Response.json({
            configured: false,
            error: String(error),
          });
        }
      },
    },

    // PUT /api/setup - Initial setup wizard config save
    "/api/setup": {
      PUT: async (req: Request) => {
        try {
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

          return Response.json({ success: true });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET/PUT /api/settings - Settings management
    "/api/settings": {
      GET: async () => {
        try {
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
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
      PUT: async (req: Request) => {
        try {
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

          const pollIntervalMinutes = await ctx.configService.getPollIntervalMinutes();
          const protectedEnvironments = await ctx.configService.getProtectedEnvironments();
          return Response.json({ settings: { pollIntervalMinutes, protectedEnvironments } });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // POST /api/refresh - Force refresh cache
    "/api/refresh": {
      POST: async () => {
        try {
          await ctx.refreshCache();
          await ctx.restartPolling(); // Reset poll timer

          const pollIntervalMinutes = await ctx.configService.getPollIntervalMinutes();
          return Response.json({
            success: true,
            lastUpdate: new Date().toISOString(),
            nextRefresh: new Date(Date.now() + pollIntervalMinutes * 60 * 1000).toISOString(),
          });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/cache/info - Cache information
    "/api/cache/info": {
      GET: async () => {
        try {
          const ticketsCache = ctx.cacheService.getCacheInfo(CACHE_KEY_TICKETS);
          const prsCache = ctx.cacheService.getCacheInfo(CACHE_KEY_PRS);
          const pollIntervalMinutes = await ctx.configService.getPollIntervalMinutes();

          return Response.json({
            tickets: ticketsCache,
            prs: prsCache,
            pollIntervalMinutes,
            lastRefreshTime: new Date(ctx.getLastRefreshTime()).toISOString(),
          });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },
  };
}
