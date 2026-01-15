#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { JiraService } from "./services/jiraService.js";
import { SourceControlService } from "./services/sourceControlService.js";
import { AzureDevOpsService } from "./services/azureDevOpsService.js";
import { ConfigService } from "./services/configService.js";
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

  return { jiraService, sourceControlService, azureDevOpsService, config, configService };
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
      const { sourceControlService, azureDevOpsService, jiraService, config } = await getServices();

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
      const { sourceControlService, azureDevOpsService, jiraService, config } = await getServices();

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
