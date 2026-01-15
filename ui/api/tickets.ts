import type { ApiContext } from "./context";
import { CACHE_KEY_TICKETS } from "./context";

export function ticketsRoutes(ctx: ApiContext) {
  return {
    // GET /api/tickets - Get all tickets with linked PRs (from cache)
    "/api/tickets": {
      GET: async () => {
        try {
          // Try to get from cache first
          const cached = ctx.cacheService.get<{ tickets: any[]; jiraHost: string }>(CACHE_KEY_TICKETS);

          if (cached) {
            const cacheInfo = ctx.cacheService.getCacheInfo(CACHE_KEY_TICKETS);
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
          const tickets = await linkingService.getTicketsWithPRs();
          const data = { tickets, jiraHost: jiraConfig.host };

          // Store in cache
          ctx.cacheService.set(CACHE_KEY_TICKETS, data);

          return Response.json(data);
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/tickets/:key - Get single ticket
    "/api/tickets/:key": {
      GET: async (req: Request & { params: { key: string } }) => {
        try {
          const { jiraService, jiraConfig } = await ctx.getServices();
          const ticket = await jiraService.getIssue(req.params.key);
          return Response.json({
            ticket,
            jiraHost: jiraConfig.host,
          });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },
  };
}
