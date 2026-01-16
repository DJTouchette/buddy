export interface PRReviewer {
  id: string;
  displayName: string;
  vote: number; // 10 = approved, 5 = approved with suggestions, 0 = no vote, -5 = waiting for author, -10 = rejected
  isRequired?: boolean;
  isContainer?: boolean; // true for group reviewers like "QA Team"
}

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
  webUrl: string; // User-facing Azure DevOps URL
  reviewers?: PRReviewer[];
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

export interface PRThreadComment {
  id: number;
  content: string;
  author: {
    displayName: string;
    imageUrl?: string;
  };
  publishedDate: string;
  lastUpdatedDate: string;
  commentType: string;
}

export interface PRThread {
  id: number;
  status: string;
  comments: PRThreadComment[];
  threadContext?: {
    filePath?: string;
    rightFileStart?: { line: number };
    rightFileEnd?: { line: number };
  };
  publishedDate: string;
  lastUpdatedDate: string;
  isDeleted: boolean;
}

export interface PolicyEvaluation {
  evaluationId: string;
  status: "approved" | "rejected" | "running" | "queued" | "notApplicable" | "broken";
  configuration: {
    id: number;
    type: {
      id: string;
      displayName: string;
    };
    isEnabled: boolean;
    isBlocking: boolean;
    settings?: {
      buildDefinitionId?: number;
      displayName?: string;
      requiredReviewerIds?: string[];
      minimumApproverCount?: number;
    };
  };
  context?: {
    buildId?: number;
    buildDefinitionId?: number;
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

  /**
   * Construct the web URL for a pull request (user-facing Azure DevOps URL)
   */
  private getPRWebUrl(pullRequestId: number): string {
    return `https://dev.azure.com/${this.organization}/${this.project}/_git/${this.repositoryId}/pullrequest/${pullRequestId}`;
  }

  /**
   * Add webUrl to a PR object
   */
  private enrichPR(pr: Omit<PullRequest, "webUrl">): PullRequest {
    return {
      ...pr,
      webUrl: this.getPRWebUrl(pr.pullRequestId),
    };
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

    const pr = await this.request<Omit<PullRequest, "webUrl">>(
      `/git/repositories/${this.repositoryId}/pullrequests?api-version=7.0`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    return this.enrichPR(pr);
  }

  async getPullRequest(pullRequestId: number): Promise<PullRequest> {
    const pr = await this.request<Omit<PullRequest, "webUrl">>(
      `/git/repositories/${this.repositoryId}/pullrequests/${pullRequestId}?api-version=7.0`
    );
    return this.enrichPR(pr);
  }

  async updatePullRequestDescription(pullRequestId: number, description: string): Promise<PullRequest> {
    const pr = await this.request<Omit<PullRequest, "webUrl">>(
      `/git/repositories/${this.repositoryId}/pullrequests/${pullRequestId}?api-version=7.0`,
      {
        method: "PATCH",
        body: JSON.stringify({ description }),
      }
    );
    return this.enrichPR(pr);
  }

  async getPullRequestStatuses(pullRequestId: number): Promise<PullRequestStatus[]> {
    const response = await this.request<{ value: PullRequestStatus[] }>(
      `/git/repositories/${this.repositoryId}/pullrequests/${pullRequestId}/statuses?api-version=7.0`
    );
    return response.value;
  }

  /**
   * Get policy evaluations for a PR (includes build status, required reviewers, etc.)
   */
  async getPolicyEvaluations(pullRequestId: number): Promise<PolicyEvaluation[]> {
    // Get the project ID first (we need it for the artifact ID)
    const projectResponse = await this.request<{ id: string }>(
      `https://dev.azure.com/${this.organization}/_apis/projects/${this.project}?api-version=7.0`
    );
    const projectId = projectResponse.id;

    // Artifact ID format for PRs: vstfs:///CodeReview/CodeReviewId/{projectId}/{pullRequestId}
    const artifactId = encodeURIComponent(`vstfs:///CodeReview/CodeReviewId/${projectId}/${pullRequestId}`);

    const response = await this.request<{ value: PolicyEvaluation[] }>(
      `https://dev.azure.com/${this.organization}/${this.project}/_apis/policy/evaluations?artifactId=${artifactId}&api-version=7.0-preview`
    );

    return response.value || [];
  }

  /**
   * Get the web URL for a build (logs/results page)
   */
  getBuildUrl(buildId: number): string {
    return `https://dev.azure.com/${this.organization}/${this.project}/_build/results?buildId=${buildId}&view=logs`;
  }

  /**
   * Get a combined view of PR checks (policy evaluations formatted nicely)
   */
  async getPRChecks(pullRequestId: number): Promise<Array<{
    id: string;
    name: string;
    status: string;
    isBlocking: boolean;
    type: string;
    buildId?: number;
    buildUrl?: string;
  }>> {
    const evaluations = await this.getPolicyEvaluations(pullRequestId);

    return evaluations
      .filter(e => e.configuration.isEnabled)
      .map(e => ({
        id: e.evaluationId,
        name: e.configuration.settings?.displayName || e.configuration.type.displayName,
        status: e.status,
        isBlocking: e.configuration.isBlocking,
        type: e.configuration.type.displayName,
        buildId: e.context?.buildId,
        buildUrl: e.context?.buildId ? this.getBuildUrl(e.context.buildId) : undefined,
      }));
  }

  async getCurrentBranchPR(branchName: string): Promise<PullRequest | null> {
    const response = await this.request<{ value: Omit<PullRequest, "webUrl">[] }>(
      `/git/repositories/${this.repositoryId}/pullrequests?searchCriteria.sourceRefName=refs/heads/${branchName}&searchCriteria.status=active&api-version=7.0`
    );

    return response.value.length > 0 ? this.enrichPR(response.value[0]) : null;
  }

  async searchPRByTicket(ticketNumber: string): Promise<PullRequest | null> {
    // Search for active PRs
    const response = await this.request<{ value: Omit<PullRequest, "webUrl">[] }>(
      `/git/repositories/${this.repositoryId}/pullrequests?searchCriteria.status=active&api-version=7.0`
    );

    // Find PR with ticket number in title
    const pr = response.value.find((pr) => pr.title.includes(ticketNumber));
    return pr ? this.enrichPR(pr) : null;
  }

  async getActivePullRequests(): Promise<PullRequest[]> {
    const response = await this.request<{ value: Omit<PullRequest, "webUrl">[] }>(
      `/git/repositories/${this.repositoryId}/pullrequests?searchCriteria.status=active&api-version=7.0`
    );
    return response.value.map((pr) => this.enrichPR(pr));
  }

  /**
   * Get the current user's profile from Azure DevOps
   */
  async getCurrentUser(): Promise<{ id: string; displayName: string; emailAddress: string }> {
    // Use the connection data API to get current user
    const response = await this.request<any>(
      `https://dev.azure.com/${this.organization}/_apis/connectionData?api-version=7.0-preview`
    );
    return {
      id: response.authenticatedUser?.id || response.id,
      displayName: response.authenticatedUser?.providerDisplayName || response.displayName,
      emailAddress: response.authenticatedUser?.properties?.Account?.$value || response.emailAddress,
    };
  }

  /**
   * Get PRs created by the current user
   */
  async getMyPullRequests(): Promise<PullRequest[]> {
    // Get current user first
    const connectionData = await this.request<any>(
      `https://dev.azure.com/${this.organization}/_apis/connectionData?api-version=7.0-preview`
    );
    const userId = connectionData.authenticatedUser?.id;

    if (!userId) {
      // Fallback: get all active PRs (will filter on client if needed)
      return this.getActivePullRequests();
    }

    const response = await this.request<{ value: Omit<PullRequest, "webUrl">[] }>(
      `/git/repositories/${this.repositoryId}/pullrequests?searchCriteria.status=active&searchCriteria.creatorId=${userId}&api-version=7.0`
    );
    return response.value.map((pr) => this.enrichPR(pr));
  }

  /**
   * Get PRs where current user is assigned as a reviewer
   */
  async getPRsToReview(): Promise<PullRequest[]> {
    // Get current user first
    const connectionData = await this.request<any>(
      `https://dev.azure.com/${this.organization}/_apis/connectionData?api-version=7.0-preview`
    );
    const userId = connectionData.authenticatedUser?.id;

    if (!userId) {
      return [];
    }

    const response = await this.request<{ value: Omit<PullRequest, "webUrl">[] }>(
      `/git/repositories/${this.repositoryId}/pullrequests?searchCriteria.status=active&searchCriteria.reviewerId=${userId}&api-version=7.0`
    );
    return response.value.map((pr) => this.enrichPR(pr));
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

  async getPRThreads(pullRequestId: number): Promise<PRThread[]> {
    const response = await this.request<{ value: PRThread[] }>(
      `/git/repositories/${this.repositoryId}/pullRequests/${pullRequestId}/threads?api-version=7.0`
    );

    // Filter out deleted threads and system threads, keep only user comments
    return response.value.filter(thread =>
      !thread.isDeleted &&
      thread.comments.some(c => c.commentType === "text" || c.commentType === "codeChange")
    );
  }

  /**
   * Get the web URL for a specific PR thread/comment
   */
  getPRThreadUrl(pullRequestId: number, threadId?: number): string {
    const baseUrl = this.getPRWebUrl(pullRequestId);
    return threadId ? `${baseUrl}?discussionId=${threadId}` : baseUrl;
  }

  formatPRForDisplay(pr: PullRequest): string {
    const source = pr.sourceRefName.replace("refs/heads/", "");
    const target = pr.targetRefName.replace("refs/heads/", "");
    return `PR #${pr.pullRequestId}: ${pr.title}\n  ${source} → ${target}\n  Status: ${pr.status}\n  ${pr.webUrl}`;
  }

  formatStatusForDisplay(status: PullRequestStatus): string {
    const stateIcon = status.state === "succeeded" ? "✓" : status.state === "failed" ? "✗" : "○";
    return `${stateIcon} ${status.context.name}: ${status.state} - ${status.description}`;
  }
}
