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
          `/board/${effectiveBoardId}/issue?jql=${encodeURIComponent("sprint in openSprints()")}&maxResults=500&fields=summary,status,assignee,issuetype,description,created,updated,priority,attachment,subtasks,parent`
        );
        return response.issues;
      } catch (error) {
        console.warn("Failed to use Agile API, falling back to JQL search:", error);
        // Fall through to JQL search
      }
    }

    // Fallback: use JQL search (won't have board rank order)
    const jql = `sprint in openSprints() ORDER BY rank, updated DESC`;
    return this.searchIssues(jql, 500);
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
    // Case-insensitive match
    const transition = transitions.find(
      (t) => t.to.name.toLowerCase() === statusName.toLowerCase()
    );

    if (!transition) {
      return false;
    }

    await this.transitionIssue(issueKey, transition.id);
    return true;
  }

  async getCurrentUser(): Promise<{ accountId: string; displayName: string; emailAddress: string }> {
    return this.request<{ accountId: string; displayName: string; emailAddress: string }>("/myself");
  }

  async assignIssue(issueKey: string, accountId: string | null): Promise<void> {
    await this.request(`/issue/${issueKey}/assignee`, {
      method: "PUT",
      body: JSON.stringify({
        accountId,
      }),
    });
  }

  async assignToSelf(issueKey: string): Promise<{ displayName: string }> {
    const currentUser = await this.getCurrentUser();
    await this.assignIssue(issueKey, currentUser.accountId);
    return { displayName: currentUser.displayName };
  }

  async unassignIssue(issueKey: string): Promise<void> {
    await this.assignIssue(issueKey, null);
  }

  async updateIssueDescription(issueKey: string, description: string): Promise<void> {
    // Convert markdown to ADF (Atlassian Document Format)
    const content: any[] = [];
    const lines = description.split("\n");
    let i = 0;

    const parseInlineMarks = (text: string): any[] => {
      const nodes: any[] = [];
      // Regex patterns for inline formatting
      const patterns = [
        { regex: /\*\*(.+?)\*\*/g, mark: "strong" },
        { regex: /\*(.+?)\*/g, mark: "em" },
        { regex: /`(.+?)`/g, mark: "code" },
        { regex: /~~(.+?)~~/g, mark: "strike" },
        { regex: /\[(.+?)\]\((.+?)\)/g, mark: "link" },
      ];

      // Simple approach: just return text node for now, JIRA will parse markdown
      if (text) {
        nodes.push({ type: "text", text });
      }
      return nodes;
    };

    while (i < lines.length) {
      const line = lines[i];

      // Skip empty lines
      if (!line.trim()) {
        i++;
        continue;
      }

      // Headings
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        content.push({
          type: "heading",
          attrs: { level: headingMatch[1].length },
          content: parseInlineMarks(headingMatch[2]),
        });
        i++;
        continue;
      }

      // Bullet list
      if (line.match(/^\s*[\*\-]\s+/)) {
        const listItems: any[] = [];
        while (i < lines.length && lines[i].match(/^\s*[\*\-]\s+/)) {
          const itemText = lines[i].replace(/^\s*[\*\-]\s+/, "");
          listItems.push({
            type: "listItem",
            content: [{ type: "paragraph", content: parseInlineMarks(itemText) }],
          });
          i++;
        }
        content.push({ type: "bulletList", content: listItems });
        continue;
      }

      // Ordered list
      if (line.match(/^\s*\d+\.\s+/)) {
        const listItems: any[] = [];
        while (i < lines.length && lines[i].match(/^\s*\d+\.\s+/)) {
          const itemText = lines[i].replace(/^\s*\d+\.\s+/, "");
          listItems.push({
            type: "listItem",
            content: [{ type: "paragraph", content: parseInlineMarks(itemText) }],
          });
          i++;
        }
        content.push({ type: "orderedList", content: listItems });
        continue;
      }

      // Code block
      if (line.startsWith("```")) {
        const lang = line.slice(3).trim();
        const codeLines: string[] = [];
        i++;
        while (i < lines.length && !lines[i].startsWith("```")) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // Skip closing ```
        content.push({
          type: "codeBlock",
          attrs: lang ? { language: lang } : {},
          content: codeLines.length ? [{ type: "text", text: codeLines.join("\n") }] : [],
        });
        continue;
      }

      // Blockquote
      if (line.startsWith(">")) {
        const quoteLines: string[] = [];
        while (i < lines.length && lines[i].startsWith(">")) {
          quoteLines.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        content.push({
          type: "blockquote",
          content: [{ type: "paragraph", content: parseInlineMarks(quoteLines.join("\n")) }],
        });
        continue;
      }

      // Horizontal rule
      if (line.match(/^[-*_]{3,}$/)) {
        content.push({ type: "rule" });
        i++;
        continue;
      }

      // Regular paragraph - collect consecutive non-empty lines
      const paraLines: string[] = [];
      while (i < lines.length && lines[i].trim() &&
             !lines[i].match(/^#{1,6}\s/) &&
             !lines[i].match(/^\s*[\*\-]\s+/) &&
             !lines[i].match(/^\s*\d+\.\s+/) &&
             !lines[i].startsWith("```") &&
             !lines[i].startsWith(">") &&
             !lines[i].match(/^[-*_]{3,}$/)) {
        paraLines.push(lines[i]);
        i++;
      }
      if (paraLines.length > 0) {
        content.push({
          type: "paragraph",
          content: parseInlineMarks(paraLines.join("\n")),
        });
      }
    }

    const adfDescription = {
      type: "doc",
      version: 1,
      content: content.length > 0 ? content : [{ type: "paragraph", content: [] }],
    };

    await this.request(`/issue/${issueKey}`, {
      method: "PUT",
      body: JSON.stringify({
        fields: {
          description: adfDescription,
        },
      }),
    });
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
