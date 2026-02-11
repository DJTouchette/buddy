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
import { statsRoutes } from "./stats";
import { aiRoutes } from "./ai";
import { appsyncRoutes } from "./appsync";
import { ctestRoutes } from "./ctest";

export type { ApiContext, Services, ValidatedJiraConfig, ValidatedAzureConfig } from "./context";
export { CACHE_KEY_TICKETS, CACHE_KEY_PRS, CACHE_KEY_DASHBOARD } from "./context";

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
    ...infraRoutes(ctx),
    ...jobsRoutes(ctx),
    ...dashboardRoutes(ctx),
    ...statsRoutes(ctx),
    ...aiRoutes(ctx),
    ...appsyncRoutes(ctx),
    ...ctestRoutes(ctx),
  };
}
