import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { ConfigService } from "../services/configService";
import { JiraService } from "../services/jiraService";
import { selectTicketFallback } from "../services/jiraTuiFallback";

interface JiraBrowseArgs {}

async function ensureJiraConfig(configService: ConfigService) {
  const jiraConfig = await configService.getJiraConfig();

  if (!jiraConfig?.host || !jiraConfig?.email || !jiraConfig?.apiToken) {
    console.error("JIRA not configured. Run: bud jira config");
    process.exit(1);
  }

  return {
    host: jiraConfig.host,
    email: jiraConfig.email,
    apiToken: jiraConfig.apiToken,
  };
}

export const jiraBrowseCommand: CommandModule = {
  command: "browse",
  describe: "Browse JIRA tickets interactively",
  handler: async (argv: ArgumentsCamelCase<JiraBrowseArgs>) => {
    try {
      const configService = new ConfigService();
      const jiraConfig = await ensureJiraConfig(configService);
      const jiraService = new JiraService(jiraConfig);

      await selectTicketFallback(jiraService, "browse");
    } catch (error) {
      console.error(`Error: ${error}`);
      process.exit(1);
    }
  },
};
