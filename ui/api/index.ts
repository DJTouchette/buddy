import type { ApiContext } from "./context";
import { ticketsRoutes } from "./tickets";
import { prsRoutes } from "./prs";
import { jiraRoutes } from "./jira";
import { notesRoutes } from "./notes";
import { reposRoutes } from "./repos";
import { gitRoutes } from "./git";
import { settingsRoutes } from "./settings";
import { infraRoutes } from "./infra";
import { jobsRoutes } from "./jobs";
import { dashboardRoutes } from "./dashboard";

export type { ApiContext, Services, ValidatedJiraConfig, ValidatedAzureConfig } from "./context";
export { CACHE_KEY_TICKETS, CACHE_KEY_PRS } from "./context";

/**
 * Combines all API route modules into a single routes object
 */
export function createApiRoutes(ctx: ApiContext) {
  return {
    ...ticketsRoutes(ctx),
    ...prsRoutes(ctx),
    ...jiraRoutes(ctx),
    ...notesRoutes(ctx),
    ...reposRoutes(ctx),
    ...gitRoutes(ctx),
    ...settingsRoutes(ctx),
    ...infraRoutes({ cacheService: ctx.cacheService, jobService: ctx.jobService, configService: ctx.configService }),
    ...jobsRoutes({ cacheService: ctx.cacheService, jobService: ctx.jobService, configService: ctx.configService }),
    ...dashboardRoutes(ctx),
  };
}
