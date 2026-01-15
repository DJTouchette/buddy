export interface JiraAttachment {
  id: string;
  filename: string;
  mimeType: string;
  content: string; // URL to download
  thumbnail?: string; // URL for thumbnail (images only)
  size: number;
  created: string;
  author: {
    displayName: string;
  };
}

export interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status: {
      name: string;
    };
    assignee?: {
      displayName: string;
    };
    issuetype: {
      name: string;
    };
    description?: any;
    created?: string;
    updated?: string;
    priority?: {
      name: string;
    };
    attachment?: JiraAttachment[];
    subtasks?: Array<{
      key: string;
      fields: {
        summary: string;
        status: {
          name: string;
        };
        assignee?: {
          displayName: string;
        };
        issuetype: {
          name: string;
        };
      };
    }>;
    parent?: {
      key: string;
      fields: {
        summary: string;
      };
    };
  };
}

export interface JiraSearchResponse {
  issues: JiraIssue[];
  total: number;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: {
    name: string;
  };
}

export interface JiraServiceOptions {
  host: string;
  email: string;
  apiToken: string;
  boardId?: number;
}

export class JiraService {
  private host: string;
  private authHeader: string;
  private boardId?: number;

  constructor(options: JiraServiceOptions) {
    // Ensure host has https:// prefix and no trailing slash
    let host = options.host.replace(/\/$/, "");
    if (!host.startsWith("http://") && !host.startsWith("https://")) {
      host = `https://${host}`;
    }
    this.host = host;
    const auth = btoa(`${options.email}:${options.apiToken}`);
    this.authHeader = `Basic ${auth}`;
    this.boardId = options.boardId;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.host}/rest/api/3${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        "Authorization": this.authHeader,
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`JIRA API Error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  async searchIssues(jql: string, maxResults: number = 50): Promise<JiraIssue[]> {
    const response = await this.request<JiraSearchResponse>(`/search/jql`, {
      method: "POST",
      body: JSON.stringify({
        jql,
        maxResults,
        fields: ["summary", "status", "assignee", "issuetype", "description", "created", "updated", "priority", "attachment", "subtasks", "parent"],
      }),
    });
    return response.issues;
  }

  /**
   * Request using the Agile API (for board-specific operations)
   */
  private async agileRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.host}/rest/agile/1.0${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        "Authorization": this.authHeader,
        "Content-Type": "application/json",
        "Accept": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`JIRA Agile API Error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  async getActiveSprintIssues(boardId?: number): Promise<JiraIssue[]> {
    const effectiveBoardId = boardId ?? this.boardId;

    // If we have a board ID, use the Agile API for proper rank ordering
    if (effectiveBoardId) {
      try {
        const response = await this.agileRequest<{ issues: JiraIssue[] }>(
          `/board/${effectiveBoardId}/issue?jql=${encodeURIComponent("sprint in openSprints()")}&maxResults=100&fields=summary,status,assignee,issuetype,description,created,updated,priority,attachment,subtasks,parent`
        );
        return response.issues;
      } catch (error) {
        console.warn("Failed to use Agile API, falling back to JQL search:", error);
        // Fall through to JQL search
      }
    }

    // Fallback: use JQL search (won't have board rank order)
    const jql = `sprint in openSprints() ORDER BY rank, updated DESC`;
    return this.searchIssues(jql);
  }

  async getIssue(issueKey: string): Promise<JiraIssue> {
    return this.request<JiraIssue>(`/issue/${issueKey}?fields=summary,status,assignee,issuetype,description,created,updated,priority,attachment,subtasks,parent`);
  }

  async searchByKey(keyPrefix: string): Promise<JiraIssue[]> {
    const jql = `project = ${keyPrefix} ORDER BY created DESC`;
    return this.searchIssues(jql, 100);
  }

  async getMyIssues(): Promise<JiraIssue[]> {
    const jql = `assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC`;
    return this.searchIssues(jql, 100);
  }

  async getTransitions(issueKey: string): Promise<JiraTransition[]> {
    const response = await this.request<{ transitions: JiraTransition[] }>(
      `/issue/${issueKey}/transitions`
    );
    return response.transitions;
  }

  async transitionIssue(issueKey: string, transitionId: string): Promise<void> {
    await this.request(`/issue/${issueKey}/transitions`, {
      method: "POST",
      body: JSON.stringify({
        transition: {
          id: transitionId,
        },
      }),
    });
  }

  async transitionIssueByName(issueKey: string, statusName: string): Promise<boolean> {
    const transitions = await this.getTransitions(issueKey);
    const transition = transitions.find((t) => t.to.name === statusName);

    if (!transition) {
      return false;
    }

    await this.transitionIssue(issueKey, transition.id);
    return true;
  }

  formatIssueForDisplay(issue: JiraIssue): string {
    const assignee = issue.fields.assignee?.displayName || "Unassigned";
    return `${issue.key}: ${issue.fields.summary} [${issue.fields.status.name}] - ${assignee}`;
  }

  // Convert issue to branch name format: CAS-123-Some-Description
  issueToBranchName(issue: JiraIssue): string {
    const summary = issue.fields.summary
      .replace(/[^a-zA-Z0-9\s-]/g, "") // Remove special chars
      .trim()
      .split(/\s+/) // Split on whitespace
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) // Title case
      .join("-");

    return `${issue.key}-${summary}`;
  }
}
