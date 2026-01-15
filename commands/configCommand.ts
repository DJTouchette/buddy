import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { ConfigService } from "../services/configService";

interface ConfigShowArgs {
  all?: boolean;
}

export const configCommand: CommandModule = {
  command: "config <command>",
  describe: "Configuration management",
  builder: (yargs) => {
    return yargs
      .command({
        command: "show",
        describe: "Show current configuration",
        builder: (y) =>
          y.option("all", {
            type: "boolean",
            default: false,
            describe: "Show all config including sensitive values (API tokens)",
          }),
        handler: async (argv: ArgumentsCamelCase<ConfigShowArgs>) => {
          try {
            const configService = new ConfigService();
            const config = await configService.load();

            if (Object.keys(config).length === 0) {
              console.log("No configuration found.");
              console.log("Run 'bud jira config' or 'bud pr config' to set up.");
              return;
            }

            console.log("Configuration:");
            console.log("=".repeat(60));

            // JIRA Config
            if (config.jira) {
              console.log("\n📋 JIRA:");
              console.log(`  Host: ${config.jira.host || "Not set"}`);
              console.log(`  Email: ${config.jira.email || "Not set"}`);
              if (argv.all) {
                console.log(`  API Token: ${config.jira.apiToken || "Not set"}`);
              } else {
                console.log(
                  `  API Token: ${config.jira.apiToken ? "***" + config.jira.apiToken.slice(-4) : "Not set"}`
                );
              }
            } else {
              console.log("\n📋 JIRA: Not configured");
            }

            // Git Config
            if (config.git) {
              console.log("\n🌿 Git:");
              console.log(`  Base Branches: ${config.git.baseBranches?.join(", ") || "Not set"}`);
            } else {
              console.log("\n🌿 Git: Not configured");
            }

            // Azure DevOps Config
            if (config.azureDevOps) {
              console.log("\n🔄 Azure DevOps:");
              console.log(`  Organization: ${config.azureDevOps.organization || "Not set"}`);
              console.log(`  Project: ${config.azureDevOps.project || "Not set"}`);
              console.log(`  Repository ID: ${config.azureDevOps.repositoryId || "Not set"}`);
              if (argv.all) {
                console.log(`  Token: ${config.azureDevOps.token || "Not set"}`);
              } else {
                console.log(
                  `  Token: ${config.azureDevOps.token ? "***" + config.azureDevOps.token.slice(-4) : "Not set"}`
                );
              }
            } else {
              console.log("\n🔄 Azure DevOps: Not configured");
            }

            console.log("\n" + "=".repeat(60));
            console.log(`Config file: ${configService["configPath"]}`);

            if (!argv.all) {
              console.log("\nℹ️  Use --all to show sensitive values");
            }
          } catch (error) {
            console.error(`Error: ${error}`);
            process.exit(1);
          }
        },
      })
      .command({
        command: "path",
        describe: "Show config file path",
        handler: async () => {
          const configService = new ConfigService();
          console.log(configService["configPath"]);
        },
      })
      .demandCommand()
      .help();
  },
  handler: () => {},
};
