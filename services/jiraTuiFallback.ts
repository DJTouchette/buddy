import { select, input, confirm, Separator } from "@inquirer/prompts";
import { JiraService, type JiraIssue } from "./jiraService";
import { SourceControlService } from "./sourceControlService";
import { ConfigService } from "./configService";

interface FilterOptions {
  type?: string;
  assignee?: string;
  myTickets?: boolean;
}

/**
 * Enhanced fallback ticket selector for compiled executables
 * Provides filtering, search, and better interaction
 */
export async function selectTicketFallback(
  jiraService: JiraService,
  mode: "browse" | "select"
): Promise<JiraIssue | null> {
  console.log("📋 JIRA Ticket Browser\n");

  let filters: FilterOptions = {};
  let issues: JiraIssue[] = [];

  while (true) {
    // Fetch issues based on filters
    console.log("🔍 Fetching tickets...");

    if (filters.myTickets) {
      issues = await jiraService.getMyIssues();
    } else {
      issues = await jiraService.getActiveSprintIssues();
    }

    // Apply client-side filters
    let filteredIssues = issues;

    if (filters.type) {
      filteredIssues = filteredIssues.filter((i) =>
        i.fields.issuetype.name.toLowerCase().includes(filters.type!.toLowerCase())
      );
    }

    if (filters.assignee) {
      filteredIssues = filteredIssues.filter((i) =>
        i.fields.assignee?.displayName.toLowerCase().includes(filters.assignee!.toLowerCase()) ||
        filters.assignee === "unassigned" && !i.fields.assignee
      );
    }

    console.log(`\n📊 Found ${filteredIssues.length} ticket(s)`);

    if (Object.keys(filters).length > 0) {
      console.log("🔎 Active filters:", JSON.stringify(filters));
    }

    if (filteredIssues.length === 0) {
      console.log("No tickets match your filters.\n");
      const retry = await confirm({
        message: "Clear filters and try again?",
        default: true,
      });

      if (retry) {
        filters = {};
        continue;
      } else {
        return null;
      }
    }

    // Create menu choices
    const choices: any[] = [
      new Separator("=== Actions ==="),
      { name: "🔍 Filter by type", value: "__filter_type" },
      { name: "👤 Filter by assignee", value: "__filter_assignee" },
      { name: filters.myTickets ? "📋 Show all sprint tickets" : "👤 Show my tickets only", value: "__toggle_my" },
      filters.type || filters.assignee ? { name: "❌ Clear filters", value: "__clear_filters" } : null,
      new Separator("=== Tickets ==="),
      ...filteredIssues.map((issue) => ({
        name: formatIssueChoice(issue),
        value: issue.key,
      })),
    ].filter(Boolean);

    const selection = await select({
      message: "Select an action or ticket:",
      choices,
      pageSize: 20,
    });

    // Handle actions
    if (selection === "__filter_type") {
      const types = [...new Set(issues.map((i) => i.fields.issuetype.name))];
      const typeChoices = types.map((t) => ({ name: t, value: t }));
      typeChoices.unshift({ name: "Clear filter", value: "" });

      const selectedType = await select({
        message: "Filter by issue type:",
        choices: typeChoices,
      });

      filters.type = selectedType || undefined;
      continue;
    }

    if (selection === "__filter_assignee") {
      const assigneeInput = await input({
        message: "Enter assignee name (or 'unassigned'):",
      });

      filters.assignee = assigneeInput || undefined;
      continue;
    }

    if (selection === "__toggle_my") {
      filters.myTickets = !filters.myTickets;
      continue;
    }

    if (selection === "__clear_filters") {
      filters = {};
      continue;
    }

    // Selected a ticket
    const selectedIssue = filteredIssues.find((i) => i.key === selection);

    if (!selectedIssue) {
      continue;
    }

    // Show ticket details
    showTicketDetails(selectedIssue);

    // Show action menu for ticket
    const actionResult = await showTicketActions(selectedIssue, jiraService, mode);

    if (actionResult === "select") {
      return selectedIssue;
    } else if (actionResult === "exit") {
      return null;
    }
    // If "back", continue loop
  }
}

async function showTicketActions(
  issue: JiraIssue,
  jiraService: JiraService,
  mode: "browse" | "select"
): Promise<"back" | "select" | "exit"> {
  while (true) {
    const choices: any[] = [
      new Separator("=== Actions ==="),
      { name: "🌿 Create git branch", value: "branch" },
      { name: "🔄 Change status", value: "status" },
      { name: "🌐 Open in browser", value: "browser" },
      new Separator("=== Navigation ==="),
      { name: "← Back to ticket list", value: "back" },
    ];

    if (mode === "select") {
      choices.push({ name: "✓ Use this ticket", value: "select" });
    }

    choices.push({ name: "✕ Exit", value: "exit" });

    const action = await select({
      message: `Actions for ${issue.key}:`,
      choices,
    });

    if (action === "back" || action === "select" || action === "exit") {
      return action;
    }

    if (action === "branch") {
      await createBranchFromTicket(issue, jiraService);
    } else if (action === "status") {
      await changeTicketStatus(issue, jiraService);
    } else if (action === "browser") {
      await openInBrowser(issue, jiraService);
    }
  }
}

async function createBranchFromTicket(issue: JiraIssue, jiraService: JiraService): Promise<void> {
  try {
    const configService = new ConfigService();
    const git = await SourceControlService.create();
    const currentBranch = await git.getCurrentBranch();
    const baseBranches = await configService.getBaseBranches();

    // Ask which base branch to branch from
    const branchFromChoices = [
      ...baseBranches.map((branch) => ({ name: branch, value: branch })),
      { name: `Current branch (${currentBranch})`, value: currentBranch },
    ];

    const baseBranch = await select({
      message: "Branch from:",
      choices: branchFromChoices,
    });

    // Checkout base branch if different
    if (baseBranch !== currentBranch) {
      console.log(`Checking out ${baseBranch}...`);
      await git.checkout(baseBranch);
    }

    // Pull latest
    console.log("Pulling latest changes...");
    await git.pull();

    // Suggest branch name
    const suggestedBranch = jiraService.issueToBranchName(issue);
    const branchName = await input({
      message: "Branch name:",
      default: suggestedBranch,
      validate: (value) => value.length > 0 || "Branch name cannot be empty",
    });

    await git.createBranch(branchName);
    console.log(`\n✓ Created and checked out branch: ${branchName}\n`);
  } catch (error) {
    console.error(`\n✗ Error creating branch: ${error}\n`);
  }
}

async function changeTicketStatus(issue: JiraIssue, jiraService: JiraService): Promise<void> {
  try {
    const transitions = await jiraService.getTransitions(issue.key);

    if (transitions.length === 0) {
      console.log("\n⚠️  No transitions available for this ticket\n");
      return;
    }

    const choices = transitions.map((t) => ({
      name: t.to.name,
      value: t.to.name,
    }));
    choices.unshift({ name: "← Cancel", value: "" });

    const targetStatus = await select({
      message: `Move ${issue.key} to:`,
      choices,
    });

    if (!targetStatus) {
      return;
    }

    const success = await jiraService.transitionIssueByName(issue.key, targetStatus);

    if (success) {
      console.log(`\n✓ Moved ${issue.key} to ${targetStatus}\n`);
      // Update the issue object
      issue.fields.status.name = targetStatus;
    } else {
      console.error(`\n✗ Could not move ${issue.key} to ${targetStatus}\n`);
    }
  } catch (error) {
    console.error(`\n✗ Error changing status: ${error}\n`);
  }
}

async function openInBrowser(issue: JiraIssue, jiraService: JiraService): Promise<void> {
  try {
    const configService = new ConfigService();
    const jiraConfig = await configService.getJiraConfig();

    if (!jiraConfig?.host) {
      console.error("\n✗ JIRA host not configured\n");
      return;
    }

    const url = `${jiraConfig.host}/browse/${issue.key}`;
    console.log(`\nOpening ${url}...`);

    const { execSync } = await import("child_process");

    if (process.platform === "win32") {
      execSync(`start "" "${url}"`, { shell: "cmd.exe" });
    } else if (process.platform === "darwin") {
      execSync(`open "${url}"`);
    } else {
      execSync(`xdg-open "${url}"`);
    }

    console.log("✓ Browser opened\n");
  } catch (error) {
    console.error(`\n✗ Failed to open browser: ${error}\n`);
  }
}

function formatIssueChoice(issue: JiraIssue): string {
  const status = issue.fields.status.name;
  const type = issue.fields.issuetype.name;
  const assignee = issue.fields.assignee?.displayName || "Unassigned";

  // Truncate summary if too long
  let summary = issue.fields.summary;
  if (summary.length > 50) {
    summary = summary.substring(0, 47) + "...";
  }

  return `${issue.key} | ${summary} [${status}] (${type}) - ${assignee}`;
}

function showTicketDetails(issue: JiraIssue): void {
  console.log("\n" + "=".repeat(80));
  console.log(`📋 ${issue.key}: ${issue.fields.summary}`);
  console.log("=".repeat(80));
  console.log(`Status:   ${issue.fields.status.name}`);
  console.log(`Type:     ${issue.fields.issuetype.name}`);
  console.log(`Assignee: ${issue.fields.assignee?.displayName || "Unassigned"}`);

  if (issue.fields.priority) {
    console.log(`Priority: ${issue.fields.priority.name}`);
  }

  if (issue.fields.created) {
    console.log(`Created:  ${new Date(issue.fields.created).toLocaleDateString()}`);
  }

  if (issue.fields.parent) {
    console.log(`Parent:   ${issue.fields.parent.key} - ${issue.fields.parent.fields.summary}`);
  }

  if (issue.fields.subtasks && issue.fields.subtasks.length > 0) {
    console.log(`\nSubtasks (${issue.fields.subtasks.length}):`);
    issue.fields.subtasks.forEach((subtask) => {
      console.log(`  • ${subtask.key}: ${subtask.fields.summary} [${subtask.fields.status.name}]`);
    });
  }

  console.log("=".repeat(80) + "\n");
}
