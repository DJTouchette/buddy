import { file } from "bun";
import { parse, stringify } from "yaml";
import { join } from "path";
import { homedir } from "os";

// Default JIRA workflow status sequence
export const DEFAULT_JIRA_WORKFLOW = [
  "To Do",
  "In Progress",
  "Code Review",
  "Pre-Review/Merge to master",
  "QA (Feature)",
  "QA (Final)",
  "PO Review",
  "Done",
];

export interface BuddyConfig {
  jira?: {
    host?: string;
    email?: string;
    apiToken?: string;
    boardId?: number;
    workflowStatuses?: string[];
  };
  git?: {
    baseBranches?: string[];
  };
  azureDevOps?: {
    organization?: string;
    project?: string;
    token?: string;
    repositoryId?: string;
  };
  ui?: {
    notesDir?: string;
  };
  settings?: {
    pollIntervalMinutes?: number;
    currentEnvironment?: string;
    infraStage?: "dev" | "prod" | "staging" | "int" | "demo";
    selectedRepoPath?: string;
    protectedEnvironments?: string[];
  };
}

export class ConfigService {
  private configPath: string;

  constructor(configPath?: string) {
    this.configPath = configPath || join(homedir(), ".buddy.yaml");
  }

  async load(): Promise<BuddyConfig> {
    try {
      const configFile = file(this.configPath);
      const exists = await configFile.exists();

      if (!exists) {
        return {};
      }

      const content = await configFile.text();
      return parse(content) as BuddyConfig;
    } catch (error) {
      console.error(`Error loading config: ${error}`);
      return {};
    }
  }

  async save(config: BuddyConfig): Promise<void> {
    try {
      const content = stringify(config);
      await Bun.write(this.configPath, content);
    } catch (error) {
      console.error(`Error saving config: ${error}`);
      throw error;
    }
  }

  async update(updates: Partial<BuddyConfig>): Promise<void> {
    const current = await this.load();
    const updated = { ...current, ...updates };
    await this.save(updated);
  }

  async getJiraConfig() {
    const config = await this.load();
    return config.jira;
  }

  async setJiraConfig(jiraConfig: BuddyConfig["jira"]): Promise<void> {
    const config = await this.load();
    config.jira = { ...config.jira, ...jiraConfig };
    await this.save(config);
  }

  async getGitConfig() {
    const config = await this.load();
    return config.git;
  }

  async getBaseBranches(): Promise<string[]> {
    const gitConfig = await this.getGitConfig();
    return gitConfig?.baseBranches || ["master", "nextrelease"];
  }

  async getAzureDevOpsConfig() {
    const config = await this.load();
    return config.azureDevOps;
  }

  async setAzureDevOpsConfig(azureDevOpsConfig: BuddyConfig["azureDevOps"]): Promise<void> {
    const config = await this.load();
    config.azureDevOps = { ...config.azureDevOps, ...azureDevOpsConfig };
    await this.save(config);
  }

  async getUIConfig() {
    const config = await this.load();
    return config.ui;
  }

  async setUIConfig(uiConfig: BuddyConfig["ui"]): Promise<void> {
    const config = await this.load();
    config.ui = { ...config.ui, ...uiConfig };
    await this.save(config);
  }

  // Settings operations
  async getSettings(): Promise<BuddyConfig["settings"]> {
    const config = await this.load();
    return config.settings;
  }

  async setSettings(settings: Partial<NonNullable<BuddyConfig["settings"]>>): Promise<void> {
    const config = await this.load();
    config.settings = { ...config.settings, ...settings };
    await this.save(config);
  }

  async getPollIntervalMinutes(): Promise<number> {
    const settings = await this.getSettings();
    return settings?.pollIntervalMinutes ?? 5;
  }

  async setPollIntervalMinutes(minutes: number): Promise<void> {
    await this.setSettings({ pollIntervalMinutes: minutes });
  }

  async getCurrentEnvironment(): Promise<string | null> {
    const settings = await this.getSettings();
    return settings?.currentEnvironment ?? null;
  }

  async setCurrentEnvironment(env: string | null): Promise<void> {
    const config = await this.load();
    if (env === null) {
      if (config.settings) {
        delete config.settings.currentEnvironment;
      }
    } else {
      config.settings = { ...config.settings, currentEnvironment: env };
    }
    await this.save(config);
  }

  async getInfraStage(): Promise<"dev" | "prod" | "staging" | "int" | "demo"> {
    const settings = await this.getSettings();
    return settings?.infraStage ?? "dev";
  }

  async setInfraStage(stage: "dev" | "prod" | "staging" | "int" | "demo"): Promise<void> {
    await this.setSettings({ infraStage: stage });
  }

  async getSelectedRepoPath(): Promise<string | null> {
    const settings = await this.getSettings();
    return settings?.selectedRepoPath ?? null;
  }

  async setSelectedRepoPath(path: string | null): Promise<void> {
    const config = await this.load();
    if (path === null) {
      if (config.settings) {
        delete config.settings.selectedRepoPath;
      }
    } else {
      config.settings = { ...config.settings, selectedRepoPath: path };
    }
    await this.save(config);
  }

  async getProtectedEnvironments(): Promise<string[]> {
    const settings = await this.getSettings();
    return settings?.protectedEnvironments ?? ["devnext", "master"];
  }

  async setProtectedEnvironments(envs: string[]): Promise<void> {
    await this.setSettings({ protectedEnvironments: envs });
  }

  async getJiraWorkflowStatuses(): Promise<string[]> {
    const config = await this.load();
    return config.jira?.workflowStatuses ?? DEFAULT_JIRA_WORKFLOW;
  }

  async setJiraWorkflowStatuses(statuses: string[]): Promise<void> {
    const config = await this.load();
    config.jira = { ...config.jira, workflowStatuses: statuses };
    await this.save(config);
  }
}
