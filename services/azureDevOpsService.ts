export interface PullRequest {
  pullRequestId: number;
  title: string;
  description?: string;
  sourceRefName: string;
  targetRefName: string;
  status: string;
  createdBy: {
    displayName: string;
  };
  url: string;
}

export interface PullRequestStatus {
  id: number;
  state: string;
  description: string;
  context: {
    name: string;
    genre: string;
  };
  creationDate: string;
  targetUrl?: string;
}

export interface Build {
  id: number;
  buildNumber: string;
  status: string;
  result?: string;
  queueTime: string;
  startTime?: string;
  finishTime?: string;
  url: string;
  logs?: {
    url: string;
  };
}

export interface AzureDevOpsServiceOptions {
  organization: string;
  project: string;
  token: string;
  repositoryId: string;
}

export class AzureDevOpsService {
  private organization: string;
  private project: string;
  private repositoryId: string;
  private authHeader: string;
  private baseUrl: string;

  constructor(options: AzureDevOpsServiceOptions) {
    this.organization = options.organization;
    this.project = options.project;
    this.repositoryId = options.repositoryId;
    this.authHeader = `Basic ${btoa(`:${options.token}`)}`;
    this.baseUrl = `https://dev.azure.com/${this.organization}/${this.project}/_apis`;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = endpoint.startsWith("http") ? endpoint : `${this.baseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        "Authorization": this.authHeader,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Azure DevOps API Error (${response.status}): ${errorText}`);
    }

    return response.json();
  }

  async createPullRequest(
    sourceBranch: string,
    targetBranch: string,
    title: string,
    description?: string,
    isDraft: boolean = true
  ): Promise<PullRequest> {
    const body = {
      sourceRefName: `refs/heads/${sourceBranch}`,
      targetRefName: `refs/heads/${targetBranch}`,
      title,
      description: description || "",
      isDraft,
    };

    const pr = await this.request<PullRequest>(
      `/git/repositories/${this.repositoryId}/pullrequests?api-version=7.0`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    return pr;
  }

  async getPullRequest(pullRequestId: number): Promise<PullRequest> {
    return this.request<PullRequest>(
      `/git/repositories/${this.repositoryId}/pullrequests/${pullRequestId}?api-version=7.0`
    );
  }

  async getPullRequestStatuses(pullRequestId: number): Promise<PullRequestStatus[]> {
    const response = await this.request<{ value: PullRequestStatus[] }>(
      `/git/repositories/${this.repositoryId}/pullrequests/${pullRequestId}/statuses?api-version=7.0`
    );
    return response.value;
  }

  async getCurrentBranchPR(branchName: string): Promise<PullRequest | null> {
    const response = await this.request<{ value: PullRequest[] }>(
      `/git/repositories/${this.repositoryId}/pullrequests?searchCriteria.sourceRefName=refs/heads/${branchName}&searchCriteria.status=active&api-version=7.0`
    );

    return response.value.length > 0 ? response.value[0] : null;
  }

  async searchPRByTicket(ticketNumber: string): Promise<PullRequest | null> {
    // Search for active PRs
    const response = await this.request<{ value: PullRequest[] }>(
      `/git/repositories/${this.repositoryId}/pullrequests?searchCriteria.status=active&api-version=7.0`
    );

    // Find PR with ticket number in title
    const pr = response.value.find((pr) => pr.title.includes(ticketNumber));
    return pr || null;
  }

  async getActivePullRequests(): Promise<PullRequest[]> {
    const response = await this.request<{ value: PullRequest[] }>(
      `/git/repositories/${this.repositoryId}/pullrequests?searchCriteria.status=active&api-version=7.0`
    );
    return response.value;
  }

  async getBuilds(repositoryId?: string, top: number = 10): Promise<Build[]> {
    const repoId = repositoryId || this.repositoryId;
    const response = await this.request<{ value: Build[] }>(
      `/build/builds?repositoryId=${repoId}&$top=${top}&api-version=7.0`
    );
    return response.value;
  }

  async getBuildLogs(buildId: number): Promise<string> {
    try {
      const response = await this.request<{ value: Array<{ id: number; url: string }> }>(
        `/build/builds/${buildId}/logs?api-version=7.0`
      );

      if (response.value.length === 0) {
        return "No logs available";
      }

      // Get the last log (usually the summary)
      const lastLog = response.value[response.value.length - 1];
      const logResponse = await fetch(lastLog.url, {
        headers: {
          "Authorization": this.authHeader,
        },
      });

      return await logResponse.text();
    } catch (error) {
      return `Error fetching logs: ${error}`;
    }
  }

  formatPRForDisplay(pr: PullRequest): string {
    const source = pr.sourceRefName.replace("refs/heads/", "");
    const target = pr.targetRefName.replace("refs/heads/", "");
    return `PR #${pr.pullRequestId}: ${pr.title}\n  ${source} → ${target}\n  Status: ${pr.status}\n  ${pr.url}`;
  }

  formatStatusForDisplay(status: PullRequestStatus): string {
    const stateIcon = status.state === "succeeded" ? "✓" : status.state === "failed" ? "✗" : "○";
    return `${stateIcon} ${status.context.name}: ${status.state} - ${status.description}`;
  }
}
