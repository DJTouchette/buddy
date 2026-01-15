import { JiraService, type JiraIssue } from "./jiraService";
import { AzureDevOpsService, type PullRequest } from "./azureDevOpsService";

export interface TicketWithPR extends JiraIssue {
  linkedPR?: PullRequest | null;
}

export interface PRWithTicket extends PullRequest {
  linkedTicket?: JiraIssue | null;
}

export class LinkingService {
  constructor(
    private jiraService: JiraService,
    private azureDevOpsService: AzureDevOpsService
  ) {}

  /**
   * Extract ticket key from branch name (e.g., "CAS-123-some-description" -> "CAS-123")
   */
  extractTicketFromBranch(branchName: string): string | null {
    const match = branchName.match(/([A-Z]+-\d+)/);
    return match?.[1] ?? null;
  }

  /**
   * Extract ticket key from PR title or branch
   */
  extractTicketFromPR(pr: PullRequest): string | null {
    // First try PR title
    const titleMatch = pr.title.match(/([A-Z]+-\d+)/);
    if (titleMatch?.[1]) return titleMatch[1];

    // Then try source branch
    const branchName = pr.sourceRefName.replace("refs/heads/", "");
    return this.extractTicketFromBranch(branchName);
  }

  /**
   * Get all active sprint tickets with linked PRs (batch approach)
   */
  async getTicketsWithPRs(): Promise<TicketWithPR[]> {
    const issues = await this.jiraService.getActiveSprintIssues();

    // Get all active PRs once
    const prs = await this.azureDevOpsService.getActivePullRequests();

    // Create a map of ticket key -> PR for fast lookup
    const prByTicket = new Map<string, PullRequest>();
    for (const pr of prs) {
      const ticketKey = this.extractTicketFromPR(pr);
      if (ticketKey) {
        prByTicket.set(ticketKey, pr);
      }
    }

    // Attach PRs to tickets
    return issues.map((issue) => ({
      ...issue,
      linkedPR: prByTicket.get(issue.key) || null,
    }));
  }

  /**
   * Get all active PRs with linked ticket info (batch approach)
   */
  async getPRsWithTickets(): Promise<PRWithTicket[]> {
    const prs = await this.azureDevOpsService.getActivePullRequests();

    // Extract all unique ticket keys
    const ticketKeys = new Set<string>();
    for (const pr of prs) {
      const ticketKey = this.extractTicketFromPR(pr);
      if (ticketKey) ticketKeys.add(ticketKey);
    }

    // Fetch all tickets in parallel
    const ticketPromises = Array.from(ticketKeys).map(async (key) => {
      try {
        const issue = await this.jiraService.getIssue(key);
        return [key, issue] as const;
      } catch {
        return [key, null] as const;
      }
    });

    const ticketResults = await Promise.all(ticketPromises);
    const ticketByKey = new Map<string, JiraIssue | null>(ticketResults);

    // Attach tickets to PRs
    return prs.map((pr) => {
      const ticketKey = this.extractTicketFromPR(pr);
      return {
        ...pr,
        linkedTicket: ticketKey ? ticketByKey.get(ticketKey) || null : null,
      };
    });
  }
}
