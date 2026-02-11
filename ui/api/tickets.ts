import type { ApiContext } from "./context";
import { CACHE_KEY_TICKETS } from "./context";
import { handler } from "./helpers";

export function ticketsRoutes(ctx: ApiContext) {
  return {
    // GET /api/tickets - Get all tickets with linked PRs (from cache)
    "/api/tickets": {
      GET: handler(async () => {
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
      }),
    },

    // GET /api/tickets/:key - Get single ticket
    "/api/tickets/:key": {
      GET: handler(async (req: Request) => {
        const { jiraService, jiraConfig } = await ctx.getServices();
        const ticket = await jiraService.getIssue((req as any).params.key);
        return Response.json({
          ticket,
          jiraHost: jiraConfig.host,
        });
      }),
    },
  };
}
