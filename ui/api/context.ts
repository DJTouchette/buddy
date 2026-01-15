import type { ConfigService } from "../../services/configService";
import type { CacheService } from "../../services/cacheService";
import type { NotesService } from "../../services/notesService";
import type { JobService } from "../../services/jobService";
import type { JiraService } from "../../services/jiraService";
import type { AzureDevOpsService } from "../../services/azureDevOpsService";
import type { LinkingService } from "../../services/linkingService";

export interface ValidatedJiraConfig {
  host: string;
  email: string;
  apiToken: string;
  boardId?: number;
}

export interface ValidatedAzureConfig {
  organization: string;
  project: string;
  token: string;
  repositoryId: string;
}

export interface Services {
  jiraService: JiraService;
  azureDevOpsService: AzureDevOpsService;
  linkingService: LinkingService;
  jiraConfig: ValidatedJiraConfig;
}

export interface ApiContext {
  configService: ConfigService;
  cacheService: CacheService;
  notesService: NotesService;
  jobService: JobService;
  getServices: () => Promise<Services>;
  refreshCache: () => Promise<void>;
  restartPolling: () => Promise<void>;
  getLastRefreshTime: () => number;
}

export const CACHE_KEY_TICKETS = "tickets";
export const CACHE_KEY_PRS = "prs";
