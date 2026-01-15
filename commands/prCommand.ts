import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { input, select, confirm } from "@inquirer/prompts";
import { ConfigService } from "../services/configService";
import { AzureDevOpsService } from "../services/azureDevOpsService";
import { SourceControlService } from "../services/sourceControlService";
import { JiraService } from "../services/jiraService";

interface PrCreateArgs {
  target?: string;
}

interface PrStatusArgs {
  id?: number;
  ticket?: string;
}

interface PrConfigArgs {}

async function ensureAzureDevOpsConfig(configService: ConfigService): Promise<{
  organization: string;
  project: string;
  token: string;
  repositoryId: string;
}> {
  const azureConfig = await configService.getAzureDevOpsConfig();

  if (
    azureConfig?.organization &&
    azureConfig?.project &&
    azureConfig?.token &&
    azureConfig?.repositoryId
  ) {
    return {
      organization: azureConfig.organization,
      project: azureConfig.project,
      token: azureConfig.token,
      repositoryId: azureConfig.repositoryId,
    };
  }

  console.log("Azure DevOps configuration not found. Let's set it up!\n");

  const organization = await input({
    message: "Enter your Azure DevOps organization (e.g., yourcompany):",
    validate: (value) => value.length > 0 || "Organization is required",
  });

  const project = await input({
    message: "Enter your Azure DevOps project name:",
    validate: (value) => value.length > 0 || "Project is required",
  });

  const repositoryId = await input({
    message: "Enter your repository ID (GUID):",
    validate: (value) => value.length > 0 || "Repository ID is required",
  });

  const token = await input({
    message: "Enter your Personal Access Token (PAT):",
    validate: (value) => value.length > 0 || "Token is required",
  });

  await configService.setAzureDevOpsConfig({
    organization,
    project,
    token,
    repositoryId,
  });

  console.log("\n✓ Azure DevOps configuration saved to ~/.buddy.yaml\n");

  return { organization, project, token, repositoryId };
}

export const prCommand: CommandModule = {
  command: "pr <command>",
  describe: "Pull Request operations (Azure DevOps)",
  builder: (yargs) =>
    yargs
      .command({
        command: "create [target]",
        describe: "Create a pull request from current branch",
        builder: (y) =>
          y
            .positional("target", {
              type: "string",
              describe: "Target branch (e.g., master, nextrelease)",
            })
            .strict(),
        handler: async (argv: ArgumentsCamelCase<PrCreateArgs>) => {
          try {
            const configService = new ConfigService();
            const azureConfig = await ensureAzureDevOpsConfig(configService);
            const azureDevOps = new AzureDevOpsService(azureConfig);
            const git = await SourceControlService.create();

            // Get current branch
            const currentBranch = await git.getCurrentBranch();

            if (!currentBranch) {
              console.error("Not on a branch");
              process.exit(1);
            }

            // Check if PR already exists
            const existingPR = await azureDevOps.getCurrentBranchPR(currentBranch);
            if (existingPR) {
              console.log("PR already exists for this branch:\n");
              console.log(azureDevOps.formatPRForDisplay(existingPR));
              return;
            }

            // Get target branch
            let targetBranch = argv.target;
            if (!targetBranch) {
              const baseBranches = await configService.getBaseBranches();
              targetBranch = await select({
                message: "Target branch:",
                choices: baseBranches.map((branch) => ({
                  name: branch,
                  value: branch,
                })),
              });
            }

            // Try to extract ticket number from branch name (e.g., CAS-123)
            const ticketMatch = currentBranch.match(/^([A-Z]+-\d+)/);
            let jiraLink = "Add the task's description here...";

            if (ticketMatch) {
              const ticketNumber = ticketMatch[1];
              try {
                // Try to fetch JIRA ticket
                const jiraConfig = await configService.getJiraConfig();
                if (jiraConfig?.host && jiraConfig?.email && jiraConfig?.apiToken) {
                  const jiraService = new JiraService(jiraConfig);
                  const issue = await jiraService.getIssue(ticketNumber);
                  const jiraUrl = `${jiraConfig.host}/browse/${ticketNumber}`;
                  // Create markdown link: [CAS-123: Summary](url)
                  jiraLink = `[${ticketNumber}: ${issue.fields.summary}](${jiraUrl})`;
                }
              } catch (error) {
                // If JIRA fetch fails, just use ticket number
                const jiraConfig = await configService.getJiraConfig();
                if (jiraConfig?.host) {
                  const jiraUrl = `${jiraConfig.host}/browse/${ticketNumber}`;
                  jiraLink = `[${ticketNumber}](${jiraUrl})`;
                }
              }
            }

            const defaultDescription = `### Description

${jiraLink}

### How to test/reproduce

- Step 1
- Step 2
- Step 3
- Step 4...`;

            // Get PR title and description
            const title = await input({
              message: "PR Title:",
              default: currentBranch,
              validate: (value) => value.length > 0 || "Title is required",
            });

            const description = await input({
              message: "PR Description (optional):",
              default: defaultDescription,
            });

            // Create PR
            console.log("\nCreating pull request...");
            const pr = await azureDevOps.createPullRequest(
              currentBranch,
              targetBranch,
              title,
              description
            );

            console.log("\n✓ Pull request created!\n");
            console.log(azureDevOps.formatPRForDisplay(pr));

            // Ask about moving JIRA ticket to Code Review
            if (ticketMatch) {
              const ticketNumber = ticketMatch[1];
              try {
                const jiraConfig = await configService.getJiraConfig();
                if (jiraConfig?.host && jiraConfig?.email && jiraConfig?.apiToken) {
                  const jiraService = new JiraService(jiraConfig);
                  const issue = await jiraService.getIssue(ticketNumber);

                  const shouldTransition = await confirm({
                    message: `Move ${ticketNumber} to Code Review?`,
                    default: true,
                  });

                  if (shouldTransition) {
                    const success = await jiraService.transitionIssueByName(
                      ticketNumber,
                      "Code Review"
                    );
                    if (success) {
                      console.log(`✓ Moved ${ticketNumber} to Code Review`);
                    } else {
                      console.log(`⚠ Could not move ${ticketNumber} to Code Review (transition not available)`);
                    }
                  }
                }
              } catch (error) {
                // Silently fail if JIRA transition fails
                console.log(`⚠ Could not transition JIRA ticket: ${error}`);
              }
            }
          } catch (error) {
            console.error(`Error: ${error}`);
            process.exit(1);
          }
        },
      })
      .command({
        command: "status [id]",
        describe: "View PR status and checks",
        builder: (y) =>
          y
            .positional("id", {
              type: "number",
              describe: "PR ID (defaults to current branch PR)",
            })
            .option("ticket", {
              alias: "t",
              type: "string",
              describe: "Search by ticket number (e.g., CAS-123)",
            })
            .strict(),
        handler: async (argv: ArgumentsCamelCase<PrStatusArgs>) => {
          try {
            const configService = new ConfigService();
            const azureConfig = await ensureAzureDevOpsConfig(configService);
            const azureDevOps = new AzureDevOpsService(azureConfig);

            let prId = argv.id;

            // If ticket number provided, search by ticket
            if (!prId && argv.ticket) {
              console.log(`Searching for PR with ticket ${argv.ticket}...\n`);
              const pr = await azureDevOps.searchPRByTicket(argv.ticket);
              if (!pr) {
                console.error(`No active PR found with ticket: ${argv.ticket}`);
                process.exit(1);
              }
              prId = pr.pullRequestId;
            }

            // If no ID or ticket provided, find PR for current branch
            if (!prId) {
              const git = await SourceControlService.create();
              const currentBranch = await git.getCurrentBranch();

              if (!currentBranch) {
                console.error("Not on a branch and no PR ID or ticket provided");
                process.exit(1);
              }

              const pr = await azureDevOps.getCurrentBranchPR(currentBranch);
              if (!pr) {
                console.error(`No active PR found for branch: ${currentBranch}`);
                process.exit(1);
              }
              prId = pr.pullRequestId;
            }

            // Get PR details
            console.log("Fetching PR status...\n");
            const pr = await azureDevOps.getPullRequest(prId);
            console.log(azureDevOps.formatPRForDisplay(pr));

            // Get PR statuses/checks
            console.log("\nChecks:");
            const statuses = await azureDevOps.getPullRequestStatuses(prId);

            if (statuses.length === 0) {
              console.log("  No checks found");
            } else {
              statuses.forEach((status) => {
                console.log(`  ${azureDevOps.formatStatusForDisplay(status)}`);
                if (status.targetUrl) {
                  console.log(`    ${status.targetUrl}`);
                }
              });
            }
          } catch (error) {
            console.error(`Error: ${error}`);
            process.exit(1);
          }
        },
      })
      .command({
        command: "config",
        describe: "Configure Azure DevOps credentials",
        handler: async (argv: ArgumentsCamelCase<PrConfigArgs>) => {
          try {
            const configService = new ConfigService();
            await ensureAzureDevOpsConfig(configService);
            console.log("Configuration complete!");
          } catch (error) {
            console.error(`Error: ${error}`);
            process.exit(1);
          }
        },
      })
      .demandCommand()
      .strict(),
  handler: () => {},
};
