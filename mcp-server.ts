#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { JiraService } from "./services/jiraService.js";
import { SourceControlService } from "./services/sourceControlService.js";
import { AzureDevOpsService } from "./services/azureDevOpsService.js";
import { ConfigService } from "./services/configService.js";
import { RepoService } from "./services/repoService.js";
import { NotesService } from "./services/notesService.js";
import { InfraService } from "./services/infraService.js";
import { JobService } from "./services/jobService.js";
import { mcpLogger } from "./services/mcpLogger.js";

const server = new McpServer({
  name: "buddy",
  version: "1.0.0",
});

// Helper to get configured services
async function getServices() {
  mcpLogger.log(`[MCP] getServices called`);
  const configService = new ConfigService();
  mcpLogger.log(`[MCP] ConfigService created`);

  const config = await configService.load();
  mcpLogger.log(`[MCP] Config loaded: ${JSON.stringify({
    hasJira: !!config.jira,
    hasGit: !!config.git,
    hasAzure: !!config.azureDevOps
  })}`);

  const jiraConfig = config.jira;
  const gitConfig = config.git;
  const azureConfig = config.azureDevOps;

  let jiraService: JiraService | null = null;
  let sourceControlService: SourceControlService | null = null;
  let azureDevOpsService: AzureDevOpsService | null = null;

  if (jiraConfig && jiraConfig.host && jiraConfig.email && jiraConfig.apiToken) {
    mcpLogger.log(`[MCP] Creating JiraService for host: ${jiraConfig.host}`);
    jiraService = new JiraService({
      host: jiraConfig.host,
      email: jiraConfig.email,
      apiToken: jiraConfig.apiToken,
    });
  } else {
    mcpLogger.log(`[MCP] JIRA config incomplete or missing`);
  }

  mcpLogger.log(`[MCP] Creating SourceControlService...`);
  try {
    sourceControlService = await SourceControlService.create();
    mcpLogger.log(`[MCP] ✓ SourceControlService created`);
  } catch (error) {
    mcpLogger.log(`[MCP] SourceControlService creation failed: ${error instanceof Error ? error.message : "unknown error"}`);
    sourceControlService = null;
  }

  if (azureConfig) {
    azureDevOpsService = new AzureDevOpsService({
      organization: azureConfig.organization,
      project: azureConfig.project,
      token: azureConfig.token,
      repositoryId: azureConfig.repositoryId,
    });
  }

  const repoService = new RepoService();
  const notesService = new NotesService({ notesDir: config.ui?.notesDir });
  const infraService = new InfraService(config.cassadol?.region);
  const jobService = new JobService();

  return { jiraService, sourceControlService, azureDevOpsService, config, configService, repoService, notesService, infraService, jobService };
}

// =============================================================================
// JIRA Tools
// =============================================================================

server.registerTool(
  "jira_search_issues",
  {
    description: "Search JIRA issues using JQL (JIRA Query Language)",
    inputSchema: z.object({
      jql: z.string().describe("JQL query string (e.g., 'project = PROJ AND status = Open')"),
      maxResults: z.number().optional().describe("Maximum number of results to return (default: 50)"),
    }),
  },
  async ({ jql, maxResults }) => {
    const startTime = Date.now();
    try {
      mcpLogger.log(`[MCP] ========================================`);
      mcpLogger.log(`[MCP] jira_search_issues called at ${new Date().toISOString()}`);
      mcpLogger.log(`[MCP] JQL: ${jql}`);
      mcpLogger.log(`[MCP] Max results: ${maxResults || 50}`);

      mcpLogger.log(`[MCP] Loading services...`);
      const { jiraService } = await getServices();
      mcpLogger.log(`[MCP] Services loaded in ${Date.now() - startTime}ms`);
      mcpLogger.log(`[MCP] JIRA service: ${jiraService ? "configured" : "not configured"}`);

      if (!jiraService) {
        mcpLogger.log(`[MCP] Returning error: JIRA not configured`);
        return {
          content: [{ type: "text", text: "JIRA is not configured. Run 'bud jira config' to set it up." }],
          isError: true,
        };
      }

      mcpLogger.log(`[MCP] Calling JIRA API...`);
      const apiStart = Date.now();
      const issues = await jiraService.searchIssues(jql, maxResults);
      mcpLogger.log(`[MCP] JIRA API responded in ${Date.now() - apiStart}ms`);
      mcpLogger.log(`[MCP] Found ${issues.length} issues`);

      const formatted = issues.map((issue) => jiraService.formatIssueForDisplay(issue)).join("\n");

      mcpLogger.log(`[MCP] Total request time: ${Date.now() - startTime}ms`);
      mcpLogger.log(`[MCP] Returning results...`);
      mcpLogger.log(`[MCP] ========================================`);

      return {
        content: [
          {
            type: "text",
            text: `Found ${issues.length} issue(s):\n\n${formatted}`,
          },
        ],
      };
    } catch (error) {
      mcpLogger.error(`ERROR after ${Date.now() - startTime}ms`, error);
      mcpLogger.log(`[MCP] ========================================`);
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "jira_get_active_sprint",
  {
    description: "Get all issues in the active sprint",
    inputSchema: z.object({
      boardId: z.number().optional().describe("Board ID to filter by (optional)"),
    }),
  },
  async ({ boardId }) => {
    try {
      const { jiraService } = await getServices();
      if (!jiraService) {
        return {
          content: [{ type: "text", text: "JIRA is not configured. Run 'bud jira config' to set it up." }],
          isError: true,
        };
      }

      const issues = await jiraService.getActiveSprintIssues(boardId);
      const formatted = issues.map((issue) => jiraService.formatIssueForDisplay(issue)).join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Active sprint issues (${issues.length}):\n\n${formatted}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "jira_get_issue",
  {
    description: "Get detailed information about a specific JIRA issue",
    inputSchema: z.object({
      issueKey: z.string().describe("Issue key (e.g., 'PROJ-123')"),
    }),
  },
  async ({ issueKey }) => {
    try {
      const { jiraService } = await getServices();
      if (!jiraService) {
        return {
          content: [{ type: "text", text: "JIRA is not configured. Run 'bud jira config' to set it up." }],
          isError: true,
        };
      }

      const issue = await jiraService.getIssue(issueKey);
      const details = `${issue.key}: ${issue.fields.summary}
Status: ${issue.fields.status.name}
Type: ${issue.fields.issuetype.name}
Assignee: ${issue.fields.assignee?.displayName || "Unassigned"}
Priority: ${issue.fields.priority?.name || "N/A"}
Created: ${issue.fields.created || "N/A"}
Updated: ${issue.fields.updated || "N/A"}

${issue.fields.description ? "Description:\n" + JSON.stringify(issue.fields.description, null, 2) : "No description"}

${issue.fields.subtasks && issue.fields.subtasks.length > 0 ? `Subtasks (${issue.fields.subtasks.length}):\n${issue.fields.subtasks.map(st => `  - ${st.key}: ${st.fields.summary} [${st.fields.status.name}]`).join("\n")}` : ""}

${issue.fields.parent ? `Parent: ${issue.fields.parent.key} - ${issue.fields.parent.fields.summary}` : ""}`;

      return {
        content: [{ type: "text", text: details }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "jira_get_my_issues",
  {
    description: "Get all issues assigned to the current user that are unresolved",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const { jiraService } = await getServices();
      if (!jiraService) {
        return {
          content: [{ type: "text", text: "JIRA is not configured. Run 'bud jira config' to set it up." }],
          isError: true,
        };
      }

      const issues = await jiraService.getMyIssues();
      const formatted = issues.map((issue) => jiraService.formatIssueForDisplay(issue)).join("\n");

      return {
        content: [
          {
            type: "text",
            text: `Your issues (${issues.length}):\n\n${formatted}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "jira_transition_issue",
  {
    description: "Transition a JIRA issue to a different status (e.g., 'In Progress', 'Done')",
    inputSchema: z.object({
      issueKey: z.string().describe("Issue key (e.g., 'PROJ-123')"),
      statusName: z.string().describe("Target status name (e.g., 'In Progress', 'Done', 'In Review')"),
    }),
  },
  async ({ issueKey, statusName }) => {
    try {
      const { jiraService } = await getServices();
      if (!jiraService) {
        return {
          content: [{ type: "text", text: "JIRA is not configured. Run 'bud jira config' to set it up." }],
          isError: true,
        };
      }

      const success = await jiraService.transitionIssueByName(issueKey, statusName);

      if (success) {
        return {
          content: [
            {
              type: "text",
              text: `✓ Successfully transitioned ${issueKey} to '${statusName}'`,
            },
          ],
        };
      } else {
        const transitions = await jiraService.getTransitions(issueKey);
        const available = transitions.map((t) => t.to.name).join(", ");
        return {
          content: [
            {
              type: "text",
              text: `Status '${statusName}' is not available for ${issueKey}.\nAvailable transitions: ${available}`,
            },
          ],
          isError: true,
        };
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// Git Tools
// =============================================================================

server.registerTool(
  "git_get_status",
  {
    description: "Get the current git repository status (shows modified, staged, and untracked files)",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const { sourceControlService } = await getServices();
      if (!sourceControlService) {
        return {
          content: [{ type: "text", text: "Not in a git repository." }],
          isError: true,
        };
      }

      const status = await sourceControlService.getStatus();
      return {
        content: [
          {
            type: "text",
            text: status.trim() || "Working tree clean",
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "git_get_current_branch",
  {
    description: "Get the name of the current git branch",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const { sourceControlService } = await getServices();
      if (!sourceControlService) {
        return {
          content: [{ type: "text", text: "Not in a git repository." }],
          isError: true,
        };
      }

      const branch = await sourceControlService.getCurrentBranch();
      return {
        content: [
          {
            type: "text",
            text: `Current branch: ${branch}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "git_create_branch",
  {
    description: "Create a new git branch, optionally checking it out",
    inputSchema: z.object({
      branchName: z.string().describe("Name of the branch to create"),
      checkout: z.boolean().optional().describe("Whether to checkout the new branch (default: true)"),
    }),
  },
  async ({ branchName, checkout = true }) => {
    try {
      const { sourceControlService } = await getServices();
      if (!sourceControlService) {
        return {
          content: [{ type: "text", text: "Not in a git repository." }],
          isError: true,
        };
      }

      const exists = await sourceControlService.branchExists(branchName);
      if (exists) {
        if (checkout) {
          await sourceControlService.checkout(branchName);
          return {
            content: [{ type: "text", text: `Branch '${branchName}' already exists. Checked it out.` }],
          };
        }
        return {
          content: [{ type: "text", text: `Branch '${branchName}' already exists.` }],
          isError: true,
        };
      }

      await sourceControlService.createBranch(branchName, checkout);
      return {
        content: [
          {
            type: "text",
            text: `✓ Created${checkout ? " and checked out" : ""} branch: ${branchName}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "git_add_files",
  {
    description: "Stage files for commit (git add)",
    inputSchema: z.object({
      files: z.array(z.string()).optional().describe("Array of file paths to stage (default: ['.'] for all files)"),
    }),
  },
  async ({ files = ["."] }) => {
    try {
      const { sourceControlService } = await getServices();
      if (!sourceControlService) {
        return {
          content: [{ type: "text", text: "Not in a git repository." }],
          isError: true,
        };
      }

      await sourceControlService.addFiles(files);
      return {
        content: [
          {
            type: "text",
            text: `✓ Staged files: ${files.join(", ")}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "git_commit",
  {
    description: "Commit staged changes with a message",
    inputSchema: z.object({
      message: z.string().describe("Commit message"),
    }),
  },
  async ({ message }) => {
    try {
      const { sourceControlService } = await getServices();
      if (!sourceControlService) {
        return {
          content: [{ type: "text", text: "Not in a git repository." }],
          isError: true,
        };
      }

      await sourceControlService.commit(message);
      return {
        content: [
          {
            type: "text",
            text: `✓ Committed: ${message}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "git_push",
  {
    description: "Push commits to remote repository",
    inputSchema: z.object({
      setUpstream: z.boolean().optional().describe("Whether to set upstream branch (default: true)"),
    }),
  },
  async ({ setUpstream = true }) => {
    try {
      const { sourceControlService } = await getServices();
      if (!sourceControlService) {
        return {
          content: [{ type: "text", text: "Not in a git repository." }],
          isError: true,
        };
      }

      await sourceControlService.push(setUpstream);
      return {
        content: [
          {
            type: "text",
            text: `✓ Pushed to remote${setUpstream ? " and set upstream" : ""}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// Pull Request Tools
// =============================================================================

server.registerTool(
  "pr_create",
  {
    description: "Create a pull request in Azure DevOps from current branch",
    inputSchema: z.object({
      targetBranch: z.string().optional().describe("Target branch (default: from config)"),
      title: z.string().optional().describe("PR title (default: generated from branch/JIRA)"),
      description: z.string().optional().describe("PR description (default: generated from JIRA)"),
      isDraft: z.boolean().optional().describe("Create as draft PR (default: true)"),
    }),
  },
  async ({ targetBranch, title, description, isDraft = true }) => {
    try {
      const { sourceControlService, azureDevOpsService, jiraService, configService } = await getServices();

      if (!sourceControlService) {
        return {
          content: [{ type: "text", text: "Not in a git repository." }],
          isError: true,
        };
      }

      if (!azureDevOpsService) {
        return {
          content: [{ type: "text", text: "Azure DevOps is not configured. Run 'bud pr config' to set it up." }],
          isError: true,
        };
      }

      const currentBranch = await sourceControlService.getCurrentBranch();
      const baseBranches = await configService.getBaseBranches();
      const target = targetBranch || baseBranches[0] || "main";

      // Check if PR already exists
      const existingPR = await azureDevOpsService.getCurrentBranchPR(currentBranch);
      if (existingPR) {
        return {
          content: [
            {
              type: "text",
              text: `PR already exists for branch '${currentBranch}':\n${azureDevOpsService.formatPRForDisplay(existingPR)}`,
            },
          ],
        };
      }

      // Generate title and description if not provided
      let prTitle = title || currentBranch;
      let prDescription = description || "";

      // Try to enhance with JIRA info
      if (jiraService) {
        const ticketMatch = currentBranch.match(/([A-Z]+-\d+)/);
        if (ticketMatch) {
          const ticketKey = ticketMatch[1];
          try {
            const issue = await jiraService.getIssue(ticketKey);
            if (!title) {
              prTitle = `${issue.key}: ${issue.fields.summary}`;
            }
            if (!description) {
              prDescription = `## JIRA Ticket\n[${issue.key}](${jiraService["host"]}/browse/${issue.key})\n\n**Summary:** ${issue.fields.summary}\n**Status:** ${issue.fields.status.name}\n**Type:** ${issue.fields.issuetype.name}`;
            }
          } catch {
            // Ignore JIRA errors when creating PR
          }
        }
      }

      const pr = await azureDevOpsService.createPullRequest(
        currentBranch,
        target,
        prTitle,
        prDescription,
        isDraft
      );

      return {
        content: [
          {
            type: "text",
            text: `✓ Created ${isDraft ? "draft " : ""}PR:\n${azureDevOpsService.formatPRForDisplay(pr)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "pr_get_status",
  {
    description: "Get the status and build checks for a pull request",
    inputSchema: z.object({
      prId: z.number().optional().describe("PR ID (if not provided, finds PR for current branch)"),
    }),
  },
  async ({ prId }) => {
    try {
      const { sourceControlService, azureDevOpsService } = await getServices();

      if (!azureDevOpsService) {
        return {
          content: [{ type: "text", text: "Azure DevOps is not configured. Run 'bud pr config' to set it up." }],
          isError: true,
        };
      }

      let pr;
      if (prId) {
        pr = await azureDevOpsService.getPullRequest(prId);
      } else {
        if (!sourceControlService) {
          return {
            content: [{ type: "text", text: "Not in a git repository and no PR ID provided." }],
            isError: true,
          };
        }
        const currentBranch = await sourceControlService.getCurrentBranch();
        const foundPR = await azureDevOpsService.getCurrentBranchPR(currentBranch);
        if (!foundPR) {
          return {
            content: [{ type: "text", text: `No PR found for branch '${currentBranch}'` }],
            isError: true,
          };
        }
        pr = foundPR;
      }

      const statuses = await azureDevOpsService.getPullRequestStatuses(pr.pullRequestId);

      let output = azureDevOpsService.formatPRForDisplay(pr);
      if (statuses.length > 0) {
        output += "\n\nBuild Checks:";
        statuses.forEach((status) => {
          output += `\n  ${azureDevOpsService.formatStatusForDisplay(status)}`;
        });
      } else {
        output += "\n\nNo build checks found.";
      }

      return {
        content: [{ type: "text", text: output }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// Workflow Tools
// =============================================================================

server.registerTool(
  "workflow_ticket_to_branch",
  {
    description: "Complete workflow: Get JIRA ticket and create a git branch from it",
    inputSchema: z.object({
      issueKey: z.string().describe("JIRA issue key (e.g., 'PROJ-123')"),
      checkout: z.boolean().optional().describe("Whether to checkout the new branch (default: true)"),
    }),
  },
  async ({ issueKey, checkout = true }) => {
    try {
      const { jiraService, sourceControlService } = await getServices();

      if (!jiraService) {
        return {
          content: [{ type: "text", text: "JIRA is not configured. Run 'bud jira config' to set it up." }],
          isError: true,
        };
      }

      if (!sourceControlService) {
        return {
          content: [{ type: "text", text: "Not in a git repository." }],
          isError: true,
        };
      }

      // Get the issue
      const issue = await jiraService.getIssue(issueKey);

      // Generate branch name
      const branchName = jiraService.issueToBranchName(issue);

      // Check if branch exists
      const exists = await sourceControlService.branchExists(branchName);
      if (exists) {
        if (checkout) {
          await sourceControlService.checkout(branchName);
          return {
            content: [
              {
                type: "text",
                text: `Branch '${branchName}' already exists. Checked it out.\n\nTicket: ${jiraService.formatIssueForDisplay(issue)}`,
              },
            ],
          };
        }
        return {
          content: [{ type: "text", text: `Branch '${branchName}' already exists.` }],
          isError: true,
        };
      }

      // Create branch
      await sourceControlService.createBranch(branchName, checkout);

      return {
        content: [
          {
            type: "text",
            text: `✓ Created${checkout ? " and checked out" : ""} branch: ${branchName}\n\nFrom ticket: ${jiraService.formatIssueForDisplay(issue)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "workflow_create_pr_from_ticket",
  {
    description: "Complete workflow: Create a PR with automatic JIRA ticket details",
    inputSchema: z.object({
      targetBranch: z.string().optional().describe("Target branch (default: from config)"),
      isDraft: z.boolean().optional().describe("Create as draft PR (default: true)"),
    }),
  },
  async ({ targetBranch, isDraft = true }) => {
    try {
      const { sourceControlService, azureDevOpsService, jiraService, configService } = await getServices();

      if (!sourceControlService) {
        return {
          content: [{ type: "text", text: "Not in a git repository." }],
          isError: true,
        };
      }

      if (!azureDevOpsService) {
        return {
          content: [{ type: "text", text: "Azure DevOps is not configured. Run 'bud pr config' to set it up." }],
          isError: true,
        };
      }

      const currentBranch = await sourceControlService.getCurrentBranch();
      const baseBranches = await configService.getBaseBranches();
      const target = targetBranch || baseBranches[0] || "main";

      // Check if PR already exists
      const existingPR = await azureDevOpsService.getCurrentBranchPR(currentBranch);
      if (existingPR) {
        return {
          content: [
            {
              type: "text",
              text: `PR already exists for branch '${currentBranch}':\n${azureDevOpsService.formatPRForDisplay(existingPR)}`,
            },
          ],
        };
      }

      // Extract ticket from branch name
      const ticketMatch = currentBranch.match(/([A-Z]+-\d+)/);
      if (!ticketMatch) {
        return {
          content: [
            {
              type: "text",
              text: `Branch name '${currentBranch}' doesn't contain a JIRA ticket key. Use 'pr_create' tool for manual PR creation.`,
            },
          ],
          isError: true,
        };
      }

      const ticketKey = ticketMatch[1];

      if (!jiraService) {
        return {
          content: [
            {
              type: "text",
              text: "JIRA is not configured. Cannot fetch ticket details. Run 'bud jira config' to set it up.",
            },
          ],
          isError: true,
        };
      }

      // Get JIRA issue details
      const issue = await jiraService.getIssue(ticketKey);

      // Generate PR title and description
      const prTitle = `${issue.key}: ${issue.fields.summary}`;
      const prDescription = `## JIRA Ticket
[${issue.key}](${jiraService["host"]}/browse/${issue.key})

**Summary:** ${issue.fields.summary}
**Status:** ${issue.fields.status.name}
**Type:** ${issue.fields.issuetype.name}
**Assignee:** ${issue.fields.assignee?.displayName || "Unassigned"}

## Changes
<!-- Describe your changes here -->

## Testing
<!-- Describe how to test your changes -->`;

      const pr = await azureDevOpsService.createPullRequest(
        currentBranch,
        target,
        prTitle,
        prDescription,
        isDraft
      );

      return {
        content: [
          {
            type: "text",
            text: `✓ Created ${isDraft ? "draft " : ""}PR from ticket ${issue.key}:\n${azureDevOpsService.formatPRForDisplay(pr)}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// JIRA Extended Tools
// =============================================================================

server.registerTool(
  "jira_assign_to_self",
  {
    description: "Assign a JIRA issue to yourself",
    inputSchema: z.object({
      issueKey: z.string().describe("Issue key (e.g., 'PROJ-123')"),
    }),
  },
  async ({ issueKey }) => {
    try {
      const { jiraService } = await getServices();
      if (!jiraService) {
        return {
          content: [{ type: "text", text: "JIRA is not configured. Run 'bud jira config' to set it up." }],
          isError: true,
        };
      }

      const result = await jiraService.assignToSelf(issueKey);
      return {
        content: [{ type: "text", text: `✓ Assigned ${issueKey} to ${result.displayName}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "jira_unassign",
  {
    description: "Unassign a JIRA issue (remove assignee)",
    inputSchema: z.object({
      issueKey: z.string().describe("Issue key (e.g., 'PROJ-123')"),
    }),
  },
  async ({ issueKey }) => {
    try {
      const { jiraService } = await getServices();
      if (!jiraService) {
        return {
          content: [{ type: "text", text: "JIRA is not configured. Run 'bud jira config' to set it up." }],
          isError: true,
        };
      }

      await jiraService.unassignIssue(issueKey);
      return {
        content: [{ type: "text", text: `✓ Unassigned ${issueKey}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "jira_add_comment",
  {
    description: "Add a comment to a JIRA issue, optionally with a link",
    inputSchema: z.object({
      issueKey: z.string().describe("Issue key (e.g., 'PROJ-123')"),
      comment: z.string().describe("Comment text"),
      linkUrl: z.string().optional().describe("Optional URL to include as a link"),
      linkText: z.string().optional().describe("Display text for the link (default: the URL)"),
    }),
  },
  async ({ issueKey, comment, linkUrl, linkText }) => {
    try {
      const { jiraService } = await getServices();
      if (!jiraService) {
        return {
          content: [{ type: "text", text: "JIRA is not configured. Run 'bud jira config' to set it up." }],
          isError: true,
        };
      }

      if (linkUrl) {
        await jiraService.addCommentWithLink(issueKey, comment, linkUrl, linkText || linkUrl);
      } else {
        await jiraService.addComment(issueKey, comment);
      }

      return {
        content: [{ type: "text", text: `✓ Added comment to ${issueKey}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// Git Extended Tools
// =============================================================================

server.registerTool(
  "git_diff",
  {
    description: "Get the diff between current branch and a target branch",
    inputSchema: z.object({
      targetBranch: z.string().optional().describe("Target branch to diff against (default: first base branch from config)"),
      file: z.string().optional().describe("Optional specific file path to get diff for"),
    }),
  },
  async ({ targetBranch, file }) => {
    try {
      const { repoService, configService } = await getServices();

      const baseBranches = await configService.getBaseBranches();
      const target = targetBranch || baseBranches[0] || "master";
      const cwd = process.cwd();

      let diff: string | null;
      if (file) {
        diff = await repoService.getFileDiff(cwd, target, file);
      } else {
        diff = await repoService.getDiff(cwd, target);
      }

      if (diff === null) {
        return {
          content: [{ type: "text", text: `Failed to get diff against ${target}. Make sure the branch exists on remote.` }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: diff.trim() || "No differences found." }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "git_changed_files",
  {
    description: "Get list of files changed between current branch and target branch with insertions/deletions",
    inputSchema: z.object({
      targetBranch: z.string().optional().describe("Target branch to compare against (default: first base branch from config)"),
    }),
  },
  async ({ targetBranch }) => {
    try {
      const { repoService, configService } = await getServices();

      const baseBranches = await configService.getBaseBranches();
      const target = targetBranch || baseBranches[0] || "master";
      const cwd = process.cwd();

      const result = await repoService.getChangedFiles(cwd, target);

      if (!result) {
        return {
          content: [{ type: "text", text: `Failed to get changed files against ${target}.` }],
          isError: true,
        };
      }

      const lines = result.files.map(f =>
        `${f.status.padEnd(8)} +${f.insertions} -${f.deletions}\t${f.path}`
      );
      const summary = `${result.files.length} file(s) changed, +${result.totalInsertions} -${result.totalDeletions}`;

      return {
        content: [{ type: "text", text: `${lines.join("\n")}\n\n${summary}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "git_commits",
  {
    description: "Get commit history between current branch and target branch",
    inputSchema: z.object({
      targetBranch: z.string().optional().describe("Target branch to compare against (default: first base branch from config)"),
    }),
  },
  async ({ targetBranch }) => {
    try {
      const { repoService, configService } = await getServices();

      const baseBranches = await configService.getBaseBranches();
      const target = targetBranch || baseBranches[0] || "master";
      const cwd = process.cwd();

      const commits = await repoService.getCommits(cwd, target);

      if (!commits) {
        return {
          content: [{ type: "text", text: `Failed to get commits against ${target}.` }],
          isError: true,
        };
      }

      if (commits.length === 0) {
        return {
          content: [{ type: "text", text: `No commits ahead of ${target}.` }],
        };
      }

      const lines = commits.map(c => `${c.shortHash} ${c.date} ${c.author}: ${c.subject}`);
      return {
        content: [{ type: "text", text: `${commits.length} commit(s) ahead of ${target}:\n\n${lines.join("\n")}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "git_find_ticket_branch",
  {
    description: "Find an existing local branch for a JIRA ticket key",
    inputSchema: z.object({
      ticketKey: z.string().describe("JIRA ticket key (e.g., 'CAS-123')"),
    }),
  },
  async ({ ticketKey }) => {
    try {
      const { repoService } = await getServices();
      const cwd = process.cwd();
      const branch = await repoService.findBranchForTicket(cwd, ticketKey);

      if (branch) {
        return {
          content: [{ type: "text", text: `Found branch: ${branch}` }],
        };
      }
      return {
        content: [{ type: "text", text: `No local branch found for ${ticketKey}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// PR Extended Tools
// =============================================================================

server.registerTool(
  "pr_get_comments",
  {
    description: "Get comments and review threads on a pull request",
    inputSchema: z.object({
      prId: z.number().optional().describe("PR ID (if not provided, finds PR for current branch)"),
    }),
  },
  async ({ prId }) => {
    try {
      const { sourceControlService, azureDevOpsService } = await getServices();

      if (!azureDevOpsService) {
        return {
          content: [{ type: "text", text: "Azure DevOps is not configured." }],
          isError: true,
        };
      }

      let resolvedPrId = prId;
      if (!resolvedPrId) {
        if (!sourceControlService) {
          return {
            content: [{ type: "text", text: "Not in a git repository and no PR ID provided." }],
            isError: true,
          };
        }
        const currentBranch = await sourceControlService.getCurrentBranch();
        const pr = await azureDevOpsService.getCurrentBranchPR(currentBranch);
        if (!pr) {
          return {
            content: [{ type: "text", text: `No PR found for branch '${currentBranch}'` }],
            isError: true,
          };
        }
        resolvedPrId = pr.pullRequestId;
      }

      const threads = await azureDevOpsService.getPRThreads(resolvedPrId);

      if (threads.length === 0) {
        return {
          content: [{ type: "text", text: `No comments on PR #${resolvedPrId}` }],
        };
      }

      const formatted = threads.map(thread => {
        const file = thread.threadContext?.filePath || "(general)";
        const line = thread.threadContext?.rightFileStart?.line;
        const location = line ? `${file}:${line}` : file;
        const comments = thread.comments
          .filter(c => c.content)
          .map(c => `  ${c.author.displayName}: ${c.content}`)
          .join("\n");
        return `[${thread.status}] ${location}\n${comments}`;
      }).join("\n\n");

      return {
        content: [{ type: "text", text: `PR #${resolvedPrId} — ${threads.length} thread(s):\n\n${formatted}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "pr_update_description",
  {
    description: "Update the description of a pull request",
    inputSchema: z.object({
      prId: z.number().describe("PR ID"),
      description: z.string().describe("New PR description (supports markdown)"),
    }),
  },
  async ({ prId, description }) => {
    try {
      const { azureDevOpsService } = await getServices();

      if (!azureDevOpsService) {
        return {
          content: [{ type: "text", text: "Azure DevOps is not configured." }],
          isError: true,
        };
      }

      const pr = await azureDevOpsService.updatePullRequestDescription(prId, description);
      return {
        content: [{ type: "text", text: `✓ Updated description for PR #${prId}: ${pr.title}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "pr_add_reviewer",
  {
    description: "Add a reviewer to a pull request (searches by name if no ID provided)",
    inputSchema: z.object({
      prId: z.number().describe("PR ID"),
      reviewerName: z.string().optional().describe("Reviewer name to search for"),
      reviewerId: z.string().optional().describe("Reviewer user ID (GUID) if known"),
      isRequired: z.boolean().optional().describe("Whether the reviewer is required (default: false)"),
    }),
  },
  async ({ prId, reviewerName, reviewerId, isRequired = false }) => {
    try {
      const { azureDevOpsService } = await getServices();

      if (!azureDevOpsService) {
        return {
          content: [{ type: "text", text: "Azure DevOps is not configured." }],
          isError: true,
        };
      }

      let resolvedId = reviewerId;
      if (!resolvedId && reviewerName) {
        const users = await azureDevOpsService.searchUsers(reviewerName);
        if (users.length === 0) {
          return {
            content: [{ type: "text", text: `No users found matching '${reviewerName}'` }],
            isError: true,
          };
        }
        if (users.length > 1) {
          const list = users.map(u => `  ${u.displayName} (${u.id})`).join("\n");
          return {
            content: [{ type: "text", text: `Multiple users found for '${reviewerName}'. Specify reviewerId:\n${list}` }],
            isError: true,
          };
        }
        resolvedId = users[0].id;
      }

      if (!resolvedId) {
        return {
          content: [{ type: "text", text: "Provide either reviewerName or reviewerId." }],
          isError: true,
        };
      }

      const reviewer = await azureDevOpsService.addReviewer(prId, resolvedId, isRequired);
      return {
        content: [{ type: "text", text: `✓ Added ${reviewer.displayName} as ${isRequired ? "required" : "optional"} reviewer on PR #${prId}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "pr_search",
  {
    description: "Search for pull requests by status or get PRs for the current user",
    inputSchema: z.object({
      scope: z.enum(["mine", "to-review", "all"]).describe("'mine' = PRs I created, 'to-review' = PRs I need to review, 'all' = all active PRs"),
    }),
  },
  async ({ scope }) => {
    try {
      const { azureDevOpsService } = await getServices();

      if (!azureDevOpsService) {
        return {
          content: [{ type: "text", text: "Azure DevOps is not configured." }],
          isError: true,
        };
      }

      let prs;
      let label: string;
      if (scope === "mine") {
        prs = await azureDevOpsService.getMyPullRequests();
        label = "Your active PRs";
      } else if (scope === "to-review") {
        prs = await azureDevOpsService.getPRsToReview();
        label = "PRs to review";
      } else {
        prs = await azureDevOpsService.getActivePullRequests();
        label = "All active PRs";
      }

      if (prs.length === 0) {
        return {
          content: [{ type: "text", text: `${label}: none found` }],
        };
      }

      const formatted = prs.map(pr => azureDevOpsService.formatPRForDisplay(pr)).join("\n\n");
      return {
        content: [{ type: "text", text: `${label} (${prs.length}):\n\n${formatted}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// Dashboard Tool
// =============================================================================

server.registerTool(
  "dashboard_get",
  {
    description: "Get a summary of your current work: assigned JIRA issues, your PRs, and PRs to review",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const { jiraService, azureDevOpsService } = await getServices();

      const sections: string[] = [];

      // JIRA issues
      if (jiraService) {
        try {
          const issues = await jiraService.getMyIssues();
          if (issues.length > 0) {
            const list = issues.map(i => `  ${jiraService.formatIssueForDisplay(i)}`).join("\n");
            sections.push(`📋 Assigned Issues (${issues.length}):\n${list}`);
          } else {
            sections.push("📋 Assigned Issues: none");
          }
        } catch (e) {
          sections.push(`📋 Assigned Issues: error fetching (${e instanceof Error ? e.message : String(e)})`);
        }
      }

      // My PRs
      if (azureDevOpsService) {
        try {
          const myPrs = await azureDevOpsService.getMyPullRequests();
          if (myPrs.length > 0) {
            const list = myPrs.map(pr => `  ${azureDevOpsService.formatPRForDisplay(pr)}`).join("\n");
            sections.push(`🔀 Your PRs (${myPrs.length}):\n${list}`);
          } else {
            sections.push("🔀 Your PRs: none");
          }
        } catch (e) {
          sections.push(`🔀 Your PRs: error fetching (${e instanceof Error ? e.message : String(e)})`);
        }

        try {
          const toReview = await azureDevOpsService.getPRsToReview();
          if (toReview.length > 0) {
            const list = toReview.map(pr => `  ${azureDevOpsService.formatPRForDisplay(pr)}`).join("\n");
            sections.push(`👀 PRs to Review (${toReview.length}):\n${list}`);
          } else {
            sections.push("👀 PRs to Review: none");
          }
        } catch (e) {
          sections.push(`👀 PRs to Review: error fetching (${e instanceof Error ? e.message : String(e)})`);
        }
      }

      if (sections.length === 0) {
        return {
          content: [{ type: "text", text: "No services configured. Set up JIRA and/or Azure DevOps." }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: sections.join("\n\n") }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// Notes Tools
// =============================================================================

server.registerTool(
  "notes_list",
  {
    description: "List all saved notes, optionally filtered by type (ticket or pr)",
    inputSchema: z.object({
      type: z.enum(["ticket", "pr"]).optional().describe("Filter by note type"),
    }),
  },
  async ({ type }) => {
    try {
      const { notesService } = await getServices();
      const notes = await notesService.listNotes(type);

      if (notes.length === 0) {
        return {
          content: [{ type: "text", text: type ? `No ${type} notes found.` : "No notes found." }],
        };
      }

      const list = notes.map(n =>
        `[${n.type}] ${n.id} (updated ${n.updatedAt.toLocaleDateString()})`
      ).join("\n");

      return {
        content: [{ type: "text", text: `${notes.length} note(s):\n${list}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "notes_get",
  {
    description: "Get a saved note for a ticket or PR",
    inputSchema: z.object({
      type: z.enum(["ticket", "pr"]).describe("Note type"),
      id: z.string().describe("Ticket key or PR ID"),
    }),
  },
  async ({ type, id }) => {
    try {
      const { notesService } = await getServices();
      const note = await notesService.getNote(type, id);

      if (!note) {
        return {
          content: [{ type: "text", text: `No note found for ${type} ${id}` }],
        };
      }

      return {
        content: [{ type: "text", text: `[${note.type}] ${note.id}\nUpdated: ${note.updatedAt.toLocaleDateString()}\n\n${note.content}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "notes_save",
  {
    description: "Save a note for a ticket or PR (creates or updates)",
    inputSchema: z.object({
      type: z.enum(["ticket", "pr"]).describe("Note type"),
      id: z.string().describe("Ticket key or PR ID"),
      content: z.string().describe("Markdown content for the note"),
    }),
  },
  async ({ type, id, content }) => {
    try {
      const { notesService } = await getServices();
      const note = await notesService.saveNote(type, id, content);

      return {
        content: [{ type: "text", text: `✓ Saved note for ${note.type} ${note.id}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// Infrastructure Tools
// =============================================================================

server.registerTool(
  "infra_get_environments",
  {
    description: "List all CloudFormation environments and their stacks",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const { infraService } = await getServices();
      const environments = await infraService.listEnvironments();

      if (environments.length === 0) {
        return {
          content: [{ type: "text", text: "No CloudFormation environments found." }],
        };
      }

      const formatted = environments.map(env => {
        const stacks = env.stacks.map(s => `    ${s.name} [${s.status}]`).join("\n");
        return `${env.suffix} (${env.stacks.length} stacks):\n${stacks}`;
      }).join("\n\n");

      return {
        content: [{ type: "text", text: `${environments.length} environment(s):\n\n${formatted}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "infra_list_lambdas",
  {
    description: "List AWS Lambda functions deployed in your account",
    inputSchema: z.object({
      environment: z.string().optional().describe("Filter by environment name (e.g., 'dev', 'staging')"),
    }),
  },
  async ({ environment }) => {
    try {
      const { infraService } = await getServices();
      const lambdas = await infraService.listAwsLambdas(environment);

      if (lambdas.length === 0) {
        return {
          content: [{ type: "text", text: environment ? `No Lambda functions found for environment '${environment}'.` : "No Lambda functions found." }],
        };
      }

      const formatted = lambdas.map(l =>
        `${l.functionName}\n  Runtime: ${l.runtime || "N/A"} | Memory: ${l.memorySize || "N/A"}MB | Timeout: ${l.timeout || "N/A"}s${l.localName ? `\n  Local handler: ${l.localName}` : ""}`
      ).join("\n\n");

      return {
        content: [{ type: "text", text: `${lambdas.length} Lambda function(s):\n\n${formatted}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "infra_lambda_details",
  {
    description: "Get detailed information about a specific AWS Lambda function including environment variables",
    inputSchema: z.object({
      functionName: z.string().describe("AWS Lambda function name"),
    }),
  },
  async ({ functionName }) => {
    try {
      const { infraService } = await getServices();
      const details = await infraService.getAwsLambdaDetails(functionName);

      if (!details) {
        return {
          content: [{ type: "text", text: `Lambda function '${functionName}' not found.` }],
          isError: true,
        };
      }

      const { config: cfg, envVars } = details;
      const envVarsList = Object.entries(envVars)
        .map(([k, v]) => `  ${k}=${v}`)
        .join("\n");

      const text = `${cfg.functionName}
Runtime: ${cfg.runtime || "N/A"}
Memory: ${cfg.memorySize || "N/A"}MB
Timeout: ${cfg.timeout || "N/A"}s
Code Size: ${cfg.codeSize ? `${(cfg.codeSize / 1024 / 1024).toFixed(1)}MB` : "N/A"}
Last Modified: ${cfg.lastModified || "N/A"}
Handler: ${cfg.handler || "N/A"}
Description: ${cfg.description || "N/A"}
Console: ${infraService.getLambdaConsoleUrl(functionName)}
Logs: ${infraService.getLambdaLogsConsoleUrl(functionName)}
${envVarsList ? `\nEnvironment Variables:\n${envVarsList}` : ""}`;

      return {
        content: [{ type: "text", text }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// Job Tools
// =============================================================================

server.registerTool(
  "job_list",
  {
    description: "List recent jobs (builds, deploys, tests) or active jobs only",
    inputSchema: z.object({
      activeOnly: z.boolean().optional().describe("Only show active/running jobs (default: false)"),
      limit: z.number().optional().describe("Number of recent jobs to return (default: 20)"),
    }),
  },
  async ({ activeOnly, limit = 20 }) => {
    try {
      const { jobService } = await getServices();

      const jobs = activeOnly ? jobService.getActiveJobs() : jobService.getRecentJobs(limit);

      if (jobs.length === 0) {
        return {
          content: [{ type: "text", text: activeOnly ? "No active jobs." : "No recent jobs." }],
        };
      }

      const formatted = jobs.map(j => {
        const duration = j.completedAt ? `${((j.completedAt - j.startedAt) / 1000).toFixed(0)}s` : "running";
        return `[${j.status}] ${j.type}: ${j.target} (${duration})${j.error ? ` — ${j.error}` : ""}`;
      }).join("\n");

      return {
        content: [{ type: "text", text: `${jobs.length} job(s):\n\n${formatted}` }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

server.registerTool(
  "job_get",
  {
    description: "Get details and output of a specific job by ID",
    inputSchema: z.object({
      jobId: z.string().describe("Job ID"),
    }),
  },
  async ({ jobId }) => {
    try {
      const { jobService } = await getServices();
      const job = jobService.getJob(jobId);

      if (!job) {
        return {
          content: [{ type: "text", text: `Job '${jobId}' not found.` }],
          isError: true,
        };
      }

      const duration = job.completedAt ? `${((job.completedAt - job.startedAt) / 1000).toFixed(0)}s` : "still running";
      const lastOutput = job.output.slice(-50).join("\n");

      const text = `Job: ${job.id}
Type: ${job.type}
Target: ${job.target}
Status: ${job.status}
Duration: ${duration}
${job.error ? `Error: ${job.error}` : ""}
${lastOutput ? `\nLast output:\n${lastOutput}` : ""}`;

      return {
        content: [{ type: "text", text }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// =============================================================================
// Stats Tool
// =============================================================================

server.registerTool(
  "stats_get",
  {
    description: "Get your productivity stats: tickets completed, PRs created, and PRs merged over the past 12 months",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const { jiraService, azureDevOpsService } = await getServices();

      if (!jiraService || !azureDevOpsService) {
        return {
          content: [{ type: "text", text: "Both JIRA and Azure DevOps must be configured for stats." }],
          isError: true,
        };
      }

      // Get completed tickets
      const jql = `assignee was currentUser() AND resolution IS NOT EMPTY AND resolutiondate >= -365d ORDER BY resolutiondate DESC`;
      let tickets: any[] = [];
      try {
        tickets = await jiraService.searchIssues(jql, 500);
      } catch {
        // Try fallback
        try {
          tickets = await jiraService.searchIssues(`assignee = currentUser() AND status = Done AND updated >= -365d`, 500);
        } catch {}
      }

      // Get PRs
      let completedPRs: any[] = [];
      let activePRs: any[] = [];
      try {
        completedPRs = await azureDevOpsService.getCompletedPullRequests(365);
        activePRs = await azureDevOpsService.getMyPullRequests();
      } catch {}

      const totalPRs = completedPRs.length + activePRs.length;
      const mergedPRs = completedPRs.filter((pr: any) => pr.status === "completed").length;

      const text = `Past 12 Months:
  Tickets completed: ${tickets.length}
  PRs created: ${totalPRs}
  PRs merged: ${mergedPRs}`;

      return {
        content: [{ type: "text", text }],
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  }
);

// Validate configuration on startup
async function validateConfig() {
  mcpLogger.log("[MCP] Validating configuration...");

  const configService = new ConfigService();
  const config = await configService.load();

  const issues: string[] = [];

  // Check JIRA config
  if (!config.jira || !config.jira.host || !config.jira.email || !config.jira.apiToken) {
    issues.push("JIRA is not fully configured. Run 'bud jira config' to set it up.");
  } else {
    mcpLogger.log(`[MCP] ✓ JIRA configured: ${config.jira.host}`);
  }

  // Check Azure DevOps config
  if (!config.azureDevOps || !config.azureDevOps.organization || !config.azureDevOps.project ||
      !config.azureDevOps.token || !config.azureDevOps.repositoryId) {
    issues.push("Azure DevOps is not fully configured. Run 'bud pr config' to set it up.");
  } else {
    mcpLogger.log(`[MCP] ✓ Azure DevOps configured: ${config.azureDevOps.organization}/${config.azureDevOps.project}`);
  }

  // Git config is optional (checked per-tool)
  if (config.git && config.git.baseBranches) {
    mcpLogger.log(`[MCP] ✓ Git configured: base branches [${config.git.baseBranches.join(", ")}]`);
  }

  if (issues.length > 0) {
    mcpLogger.log("\n[MCP] ❌ Configuration issues found:");
    issues.forEach(issue => mcpLogger.log(`[MCP]    - ${issue}`));
    mcpLogger.log(`[MCP]\n[MCP] Config file: ${configService["configPath"]}`);
    mcpLogger.log("[MCP]\n[MCP] MCP server will start, but some tools may not work.");
    mcpLogger.log("[MCP] Configure missing services to enable all features.\n");
  } else {
    mcpLogger.log("[MCP] ✓ All services configured");
  }

  return config;
}

// Start the server
export async function startMcpServer() {
  mcpLogger.log("[MCP] Starting MCP server...");
  mcpLogger.log(`[MCP] Process: ${process.execPath}`);
  mcpLogger.log(`[MCP] CWD: ${process.cwd()}`);
  mcpLogger.log(`[MCP] Platform: ${process.platform}`);
  mcpLogger.log(`[MCP] Node version: ${process.version}`);

  // Validate config before starting
  await validateConfig();

  mcpLogger.log("[MCP] Creating transport...");
  const transport = new StdioServerTransport();

  mcpLogger.log("[MCP] Connecting to transport...");
  await server.connect(transport);

  mcpLogger.log("[MCP] ✓ Buddy MCP Server running on stdio");
  mcpLogger.log("[MCP] Waiting for requests...");
}

// Only run if this file is executed directly
if (import.meta.main) {
  startMcpServer().catch((error) => {
    mcpLogger.error("Fatal error in MCP server", error);
    process.exit(1);
  });
}
