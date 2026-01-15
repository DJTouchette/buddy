import type { CommandModule, ArgumentsCamelCase } from "yargs";
import { select, input } from "@inquirer/prompts";
import { ConfigService } from "../services/configService";
import { JiraService } from "../services/jiraService";
import { SourceControlService } from "../services/sourceControlService";
import { NotesService } from "../services/notesService";
import { jiraBrowseCommand } from "./jiraBrowseCommand";
import { selectTicketFallback } from "../services/jiraTuiFallback";

interface JiraTicketArgs {
  ticket?: string;
  noBranch?: boolean;
}

interface JiraMoveArgs {
  ticket?: string;
  status?: string;
}

interface JiraNoteArgs {
  ticket?: string;
}

interface JiraConfigArgs {}

async function ensureJiraConfig(configService: ConfigService): Promise<{ host: string; email: string; apiToken: string }> {
  const jiraConfig = await configService.getJiraConfig();

  if (jiraConfig?.host && jiraConfig?.email && jiraConfig?.apiToken) {
    return {
      host: jiraConfig.host,
      email: jiraConfig.email,
      apiToken: jiraConfig.apiToken,
    };
  }

  console.log("JIRA configuration not found. Let's set it up!\n");

  const host = await input({
    message: "Enter your JIRA host (e.g., https://yourcompany.atlassian.net):",
    validate: (value) => value.length > 0 || "Host is required",
  });

  const email = await input({
    message: "Enter your JIRA email:",
    validate: (value) => value.includes("@") || "Valid email is required",
  });

  const apiToken = await input({
    message: "Enter your JIRA API token:",
    validate: (value) => value.length > 0 || "API token is required",
  });

  await configService.setJiraConfig({ host, email, apiToken });

  console.log("\n✓ JIRA configuration saved to ~/.buddy.yaml\n");

  return { host, email, apiToken };
}

export const jiraCommand: CommandModule = {
  command: "jira <command>",
  describe: "JIRA operations",
  builder: (yargs) =>
    yargs
      .command({
        command: "ticket [ticket]",
        describe: "Select a ticket from active sprint and create a branch",
        builder: (y) =>
          y
            .positional("ticket", {
              type: "string",
              describe: "Pre-select a specific ticket (e.g., CAS-123)",
            })
            .option("no-branch", {
              type: "boolean",
              default: false,
              describe: "Don't create a git branch, just show ticket info",
            })
            .strict(),
        handler: async (argv: ArgumentsCamelCase<JiraTicketArgs>) => {
          try {
            const configService = new ConfigService();
            const jiraConfig = await ensureJiraConfig(configService);
            const jiraService = new JiraService(jiraConfig);

            let selectedIssue;

            if (argv.ticket) {
              // Pre-selected ticket
              console.log(`Fetching ticket ${argv.ticket}...`);
              selectedIssue = await jiraService.getIssue(argv.ticket);
              console.log(`\n${jiraService.formatIssueForDisplay(selectedIssue)}\n`);
            } else {
              selectedIssue = await selectTicketFallback(jiraService, "select");

              if (!selectedIssue) {
                console.log("No ticket selected.");
                return;
              }

              console.log(`\n${jiraService.formatIssueForDisplay(selectedIssue)}\n`);
            }

            if (argv.noBranch) {
              console.log("Ticket selected (no branch created)");
              return;
            }

            // Get git service
            const git = await SourceControlService.create();
            const currentBranch = await git.getCurrentBranch();

            // Get base branches from config
            const baseBranches = await configService.getBaseBranches();

            // Ask which base branch to branch from
            const branchFromChoices = [
              ...baseBranches.map(branch => ({
                name: branch,
                value: branch,
              })),
              {
                name: `Current branch (${currentBranch})`,
                value: currentBranch,
              },
            ];

            const baseBranch = await select({
              message: "Branch from:",
              choices: branchFromChoices,
            });

            // Checkout base branch if it's not the current one
            if (baseBranch !== currentBranch) {
              await git.checkout(baseBranch);
            }

            // Pull latest changes
            await git.pull();

            // Create git branch
            const suggestedBranchName = jiraService.issueToBranchName(selectedIssue);

            const branchName = await input({
              message: "Branch name:",
              default: suggestedBranchName,
              validate: (value) => value.length > 0 || "Branch name cannot be empty",
            });

            await git.createBranch(branchName);
            console.log(`\n✓ Ready to work on ${selectedIssue.key}!`);
          } catch (error) {
            console.error(`Error: ${error}`);
            process.exit(1);
          }
        },
      })
      .command(jiraBrowseCommand)
      .command({
        command: "move [ticket] [status]",
        describe: "Move a JIRA ticket to a different status",
        builder: (y) =>
          y
            .positional("ticket", {
              type: "string",
              describe: "Ticket number (e.g., CAS-123). Defaults to current branch ticket.",
            })
            .positional("status", {
              type: "string",
              describe: "Target status. If not provided, you'll select from available transitions.",
            })
            .strict(),
        handler: async (argv: ArgumentsCamelCase<JiraMoveArgs>) => {
          try {
            const configService = new ConfigService();
            const jiraConfig = await ensureJiraConfig(configService);
            const jiraService = new JiraService(jiraConfig);

            let ticketNumber = argv.ticket;

            // If no ticket provided, try to get from current branch
            if (!ticketNumber) {
              const git = await SourceControlService.create();
              const currentBranch = await git.getCurrentBranch();
              const ticketMatch = currentBranch.match(/^([A-Z]+-\d+)/);

              if (!ticketMatch) {
                console.error("No ticket number provided and could not extract from branch name");
                process.exit(1);
              }

              ticketNumber = ticketMatch[1];
            }

            console.log(`Fetching ${ticketNumber}...\n`);
            const issue = await jiraService.getIssue(ticketNumber);
            console.log(jiraService.formatIssueForDisplay(issue));
            console.log(`Current status: ${issue.fields.status.name}\n`);

            let targetStatus = argv.status;

            // Get available transitions
            const transitions = await jiraService.getTransitions(ticketNumber);

            if (transitions.length === 0) {
              console.log("No transitions available for this ticket");
              return;
            }

            // If no status provided, let user select
            if (!targetStatus) {
              const choices = transitions.map((t) => ({
                name: t.to.name,
                value: t.to.name,
              }));

              targetStatus = await select({
                message: "Move to:",
                choices,
              });
            }

            // Perform transition
            const success = await jiraService.transitionIssueByName(ticketNumber, targetStatus);

            if (success) {
              console.log(`\n✓ Moved ${ticketNumber} to ${targetStatus}`);
            } else {
              console.error(`\n✗ Could not move ${ticketNumber} to ${targetStatus} (transition not available)`);
              console.log("\nAvailable transitions:");
              transitions.forEach((t) => console.log(`  - ${t.to.name}`));
              process.exit(1);
            }
          } catch (error) {
            console.error(`Error: ${error}`);
            process.exit(1);
          }
        },
      })
      .command({
        command: "note [ticket]",
        describe: "Open or create a note for a JIRA ticket",
        builder: (y) =>
          y
            .positional("ticket", {
              type: "string",
              describe: "Ticket number (e.g., CAS-123). Defaults to current branch ticket.",
            })
            .strict(),
        handler: async (argv: ArgumentsCamelCase<JiraNoteArgs>) => {
          try {
            const configService = new ConfigService();
            const uiConfig = await configService.getUIConfig();
            const notesService = new NotesService({ notesDir: uiConfig?.notesDir });

            let ticketNumber = argv.ticket;

            // If no ticket provided, try to get from current branch
            if (!ticketNumber) {
              try {
                const git = await SourceControlService.create();
                const currentBranch = await git.getCurrentBranch();
                const ticketMatch = currentBranch.match(/([A-Z]+-\d+)/);

                if (ticketMatch) {
                  ticketNumber = ticketMatch[1];
                }
              } catch {
                // Not in a git repo, ignore
              }
            }

            if (!ticketNumber) {
              console.error("No ticket number provided and could not extract from branch name");
              console.log("\nUsage: bud jira note <ticket>");
              console.log("Example: bud jira note CAS-123");
              process.exit(1);
            }

            // Get or create the note file path
            const notePath = notesService.getNotePath("ticket", ticketNumber);

            // Ensure directory exists and create file if it doesn't
            const existingNote = await notesService.getNote("ticket", ticketNumber);
            if (!existingNote) {
              // Create empty note with a header
              await notesService.saveNote("ticket", ticketNumber, `# ${ticketNumber}\n\n`);
              console.log(`Created new note for ${ticketNumber}`);
            } else {
              console.log(`Opening note for ${ticketNumber}`);
            }

            // Open in editor
            const editor = process.env.EDITOR || process.env.VISUAL || "nvim";
            const proc = Bun.spawn([editor, notePath], {
              stdin: "inherit",
              stdout: "inherit",
              stderr: "inherit",
            });
            await proc.exited;

            console.log(`\nNote saved to: ${notePath}`);
          } catch (error) {
            console.error(`Error: ${error}`);
            process.exit(1);
          }
        },
      })
      .command({
        command: "config",
        describe: "Configure JIRA credentials",
        handler: async (argv: ArgumentsCamelCase<JiraConfigArgs>) => {
          try {
            const configService = new ConfigService();
            await ensureJiraConfig(configService);
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
