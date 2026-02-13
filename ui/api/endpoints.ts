export interface ApiEndpoint {
  path: string;
  method: string;
  description: string;
  params?: Record<string, string>;
  queryParams?: Record<string, string>;
  body?: Record<string, string>;
  response?: string;
  examples?: Array<{
    title: string;
    description?: string;
    request?: string;
    notes?: string;
  }>;
}

export const API_ENDPOINTS: ApiEndpoint[] = [
  // ── Dashboard ──
  {
    path: "/api/dashboard",
    method: "GET",
    description: "Get all dashboard data (issues, PRs, reviews) in one call. Includes assigned issues, your PRs, PRs to review, failed builds, stale PRs, and team overview.",
    queryParams: { refresh: "boolean – force refresh bypassing cache" },
    examples: [
      { title: "Get dashboard (cached)", request: "GET /api/dashboard" },
      { title: "Force fresh data", request: "GET /api/dashboard?refresh=true", notes: "Bypasses cache and fetches live from Jira and Azure DevOps" },
    ],
  },
  {
    path: "/api/dashboard/debug",
    method: "GET",
    description: "Debug endpoint showing user info and connection data",
  },
  {
    path: "/api/dashboard/issues",
    method: "GET",
    description: "Get issues assigned to the current user",
  },
  {
    path: "/api/dashboard/my-prs",
    method: "GET",
    description: "Get pull requests created by the current user",
  },
  {
    path: "/api/dashboard/to-review",
    method: "GET",
    description: "Get pull requests where the current user is a reviewer",
  },
  {
    path: "/api/dashboard/stream",
    method: "GET",
    description: "SSE stream for live dashboard updates (refreshes every 60s)",
    response: "text/event-stream",
  },

  // ── Tickets ──
  {
    path: "/api/tickets",
    method: "GET",
    description: "Get all tickets with linked PRs from cache. Returns sprint tickets enriched with any matching Azure DevOps PRs. Filter client-side by status, type, or assignee.",
    examples: [
      { title: "Get all sprint tickets", request: "GET /api/tickets", notes: "Returns all tickets from the active sprint with linked PR data" },
      { title: "Find bugs", description: "Filter the response where issue.type === 'Bug'", notes: "Issue types include: Bug, Story, Task, Sub-task, Epic" },
      { title: "Find unassigned issues", description: "Filter the response where issue.assignee is null or empty" },
      { title: "Find blocked issues", description: "Filter where issue.status === 'Blocked'" },
      { title: "Find issues without PRs", description: "Filter where the linked PR array is empty – useful for finding tickets that haven't been started" },
    ],
  },
  {
    path: "/api/tickets/:key",
    method: "GET",
    description: "Get a single ticket by its key with full details including description, comments, attachments, and linked PRs",
    params: { key: "string – ticket key (e.g. PROJ-123)" },
    examples: [
      { title: "Get ticket details", request: "GET /api/tickets/PROJ-123" },
    ],
  },

  // ── Pull Requests ──
  {
    path: "/api/prs",
    method: "GET",
    description: "Get all pull requests with linked tickets from cache",
  },
  {
    path: "/api/prs/search",
    method: "GET",
    description: "Search PRs by title, branch, or author. Supports filtering by status.",
    queryParams: {
      q: "string – search query (matches title, source branch, author name)",
      status: "string – filter by status: active | completed | abandoned | all (default: active)",
    },
    examples: [
      { title: "Search active PRs", request: "GET /api/prs/search?q=login&status=active" },
      { title: "Find PRs by author", request: "GET /api/prs/search?q=damien" },
      { title: "Find PRs by branch name", request: "GET /api/prs/search?q=feature/PROJ-123" },
      { title: "List all completed PRs", request: "GET /api/prs/search?status=completed" },
    ],
  },
  {
    path: "/api/prs/:id",
    method: "GET",
    description: "Get a single PR by its ID",
    params: { id: "string – PR ID" },
  },
  {
    path: "/api/prs/:id/statuses",
    method: "GET",
    description: "Get policy evaluations and custom statuses for a PR",
    params: { id: "string – PR ID" },
  },
  {
    path: "/api/prs/:id/description",
    method: "PUT",
    description: "Update a PR's description",
    params: { id: "string – PR ID" },
    body: { description: "string – new description text" },
  },
  {
    path: "/api/prs/:id/comments",
    method: "GET",
    description: "Get comments/threads on a PR",
    params: { id: "string – PR ID" },
  },
  {
    path: "/api/prs/:id/reviewers",
    method: "POST",
    description: "Add a reviewer to a PR",
    params: { id: "string – PR ID" },
    body: { reviewerId: "string – Azure DevOps user ID" },
  },
  {
    path: "/api/prs/:id/reviewers/self",
    method: "POST",
    description: "Add current user as optional reviewer on a PR",
    params: { id: "string – PR ID" },
  },
  {
    path: "/api/prs/:id/reviewers/self",
    method: "DELETE",
    description: "Remove current user as reviewer from a PR",
    params: { id: "string – PR ID" },
  },
  {
    path: "/api/prs/:id/reviewers/:reviewerId",
    method: "DELETE",
    description: "Remove a specific reviewer from a PR",
    params: { id: "string – PR ID", reviewerId: "string – reviewer user ID" },
  },
  {
    path: "/api/prs/users/search",
    method: "GET",
    description: "Search for users to add as reviewers",
    queryParams: { q: "string – search query" },
  },

  // ── Git ──
  {
    path: "/api/git/pr-info",
    method: "GET",
    description: "Get info needed for PR creation (branch, upstream, diff, commits)",
  },
  {
    path: "/api/git/diff",
    method: "GET",
    description: "Get diff for a target branch or specific file",
    queryParams: {
      target: "string – target branch to diff against",
      file: "string – optional specific file path",
    },
  },
  {
    path: "/api/git/push",
    method: "POST",
    description: "Push current branch to remote",
  },
  {
    path: "/api/git/create-pr",
    method: "POST",
    description: "Create a new pull request in Azure DevOps from the current branch",
    body: {
      title: "string – PR title",
      description: "string – PR description (supports markdown)",
      targetBranch: "string – base branch (e.g. master, nextrelease)",
    },
    examples: [
      { title: "Create a PR to master", request: "POST /api/git/create-pr\n{\"title\": \"PROJ-123: Fix login bug\", \"description\": \"## Summary\\nFixed the login timeout issue\", \"targetBranch\": \"master\"}" },
    ],
  },
  {
    path: "/api/git/base-branches",
    method: "GET",
    description: "Get available base branches with descriptions",
  },
  {
    path: "/api/git/checkout-base",
    method: "POST",
    description: "Checkout a base branch",
    body: { branch: "string – branch name" },
  },
  {
    path: "/api/git/current-branch",
    method: "GET",
    description: "Get current branch of the selected repository",
  },
  {
    path: "/api/git/checkout-ticket",
    method: "POST",
    description: "Create and checkout a new branch from a ticket key. Generates a branch name from the ticket key and title.",
    body: {
      ticketKey: "string – e.g. PROJ-123",
      ticketTitle: "string? – ticket summary (used to generate branch name)",
      baseBranch: "string? – base branch to branch from",
    },
    examples: [
      { title: "Create branch from ticket", request: "POST /api/git/checkout-ticket\n{\"ticketKey\": \"PROJ-123\", \"ticketTitle\": \"Fix login bug\", \"baseBranch\": \"master\"}", notes: "Creates a branch like feature/PROJ-123-fix-login-bug" },
    ],
  },
  {
    path: "/api/git/checkout-pr",
    method: "POST",
    description: "Checkout a PR branch locally",
    body: { branchName: "string – remote branch name" },
    examples: [
      { title: "Checkout a PR branch", request: "POST /api/git/checkout-pr\n{\"branchName\": \"feature/PROJ-123-fix-login\"}" },
    ],
  },
  {
    path: "/api/git/ticket-branch/:ticketKey",
    method: "GET",
    description: "Find an existing local branch for a ticket key",
    params: { ticketKey: "string – ticket key" },
  },

  // ── Jobs ──
  {
    path: "/api/jobs",
    method: "GET",
    description: "List jobs (recent 30 by default, or active only)",
    queryParams: { active: "boolean – when true, return only active jobs" },
    examples: [
      { title: "List active jobs", request: "GET /api/jobs?active=true", notes: "Returns only running/awaiting-approval jobs" },
      { title: "List recent jobs", request: "GET /api/jobs", notes: "Returns the 30 most recent jobs of any status" },
    ],
  },
  {
    path: "/api/jobs",
    method: "POST",
    description: "Create and execute a new job. Deploy and build-deploy-all jobs are blocked on protected environments.",
    body: {
      type: "string – job type: build | deploy | diff | synth | deploy-lambda | tail-logs | build-frontend | build-deploy-all | ai-fix | ai-start | ctest | playwright",
      target: "string – build target (e.g. lambda name, stack name, 'all', 'web', 'backend', 'frontend')",
      skipBuild: "boolean? – skip build step (deploy-lambda)",
      awsFunctionName: "string? – AWS function name (deploy-lambda)",
    },
    examples: [
      { title: "Build a single lambda", request: "POST /api/jobs\n{\"type\": \"build\", \"target\": \"MyLambda\"}" },
      { title: "Build all lambdas", request: "POST /api/jobs\n{\"type\": \"build\", \"target\": \"all\"}" },
      { title: "CDK diff a stack", request: "POST /api/jobs\n{\"type\": \"diff\", \"target\": \"BackendStack\"}" },
      { title: "CDK deploy a stack", request: "POST /api/jobs\n{\"type\": \"deploy\", \"target\": \"BackendStack\"}", notes: "Runs diff first, then awaits approval before deploying" },
      { title: "Build & Deploy all backend", request: "POST /api/jobs\n{\"type\": \"build-deploy-all\", \"target\": \"backend\"}", notes: "Builds all lambdas, then CDK deploys the backend stack with approval" },
      { title: "Build & Deploy frontend", request: "POST /api/jobs\n{\"type\": \"build-deploy-all\", \"target\": \"frontend\"}", notes: "Builds clients/web, then CDK deploys the frontend stack with approval" },
      { title: "Build frontend web app", request: "POST /api/jobs\n{\"type\": \"build-frontend\", \"target\": \"web\"}", notes: "Runs yarn build in clients/web" },
      { title: "Build payment portal", request: "POST /api/jobs\n{\"type\": \"build-frontend\", \"target\": \"paymentportal\"}", notes: "Runs yarn build in clients/paymentportal" },
      { title: "Deploy a single Lambda to AWS", request: "POST /api/jobs\n{\"type\": \"deploy-lambda\", \"target\": \"MyLambda\", \"awsFunctionName\": \"my-env-MyLambda\"}", notes: "Builds then deploys a single Lambda function code" },
      { title: "Tail Lambda logs", request: "POST /api/jobs\n{\"type\": \"tail-logs\", \"target\": \"my-env-MyLambda\"}", notes: "Streams CloudWatch logs for the specified AWS function" },
      { title: "Run Playwright tests", request: "POST /api/jobs\n{\"type\": \"playwright\", \"target\": \"all\"}" },
    ],
  },
  {
    path: "/api/jobs/:id",
    method: "GET",
    description: "Get a specific job by ID",
    params: { id: "string – job UUID" },
  },
  {
    path: "/api/jobs/:id/output",
    method: "GET",
    description: "SSE stream of job output lines",
    params: { id: "string – job UUID" },
    response: "text/event-stream – each event: {line} or {done, status}",
  },
  {
    path: "/api/jobs/:id/cancel",
    method: "POST",
    description: "Cancel a running or awaiting-approval job",
    params: { id: "string – job UUID" },
  },
  {
    path: "/api/jobs/:id/respond",
    method: "POST",
    description: "Approve or reject a job awaiting approval (e.g. CDK deploy after diff review)",
    params: { id: "string – job UUID" },
    body: { approved: "boolean" },
    examples: [
      { title: "Approve a deploy", request: "POST /api/jobs/<id>/respond\n{\"approved\": true}", notes: "Used after reviewing CDK diff output" },
      { title: "Reject a deploy", request: "POST /api/jobs/<id>/respond\n{\"approved\": false}" },
    ],
  },
  {
    path: "/api/jobs/:id/diff",
    method: "GET",
    description: "Get the diff output for a job (used in deploy approval)",
    params: { id: "string – job UUID" },
  },
  {
    path: "/api/jobs/builds",
    method: "GET",
    description: "Get build info for all Lambda functions (last built, status, zip exists)",
  },
  {
    path: "/api/jobs/clear",
    method: "POST",
    description: "Force kill all running jobs and processes",
  },

  // ── Logs ──
  {
    path: "/api/logs/:lambdaName",
    method: "GET",
    description: "Get saved logs for a specific Lambda function",
    params: { lambdaName: "string – Lambda function name" },
  },
  {
    path: "/api/logs",
    method: "POST",
    description: "Save a log entry for a Lambda",
    body: {
      lambdaName: "string",
      name: "string – log name/label",
      content: "string – log content",
    },
  },
  {
    path: "/api/logs/view/:id",
    method: "GET",
    description: "View a specific saved log by ID",
    params: { id: "string – log UUID" },
  },
  {
    path: "/api/logs/delete/:id",
    method: "POST",
    description: "Delete a saved log",
    params: { id: "string – log UUID" },
  },

  // ── Infrastructure ──
  {
    path: "/api/infra/environments",
    method: "GET",
    description: "List all environments discovered from CloudFormation",
  },
  {
    path: "/api/infra/environments/current",
    method: "GET",
    description: "Get current environment name, stage, and protection status",
  },
  {
    path: "/api/infra/environments/current",
    method: "PUT",
    description: "Set the current environment and/or stage. Protected environments (devnext, master) block deploy operations.",
    body: {
      environment: "string? – environment name",
      stage: "string? – infra stage override",
    },
    examples: [
      { title: "Switch to dev environment", request: "PUT /api/infra/environments/current\n{\"environment\": \"dev\"}" },
      { title: "Switch environment and stage", request: "PUT /api/infra/environments/current\n{\"environment\": \"staging\", \"stage\": \"staging\"}" },
    ],
  },
  {
    path: "/api/infra/stacks",
    method: "GET",
    description: "Get CloudFormation stacks for the current environment",
  },
  {
    path: "/api/infra/lambdas",
    method: "GET",
    description: "Discover and list all Lambda functions in the backend folder",
  },
  {
    path: "/api/infra/config",
    method: "GET",
    description: "Get infrastructure paths (infraPath, backendPath) from selected repo",
  },
  {
    path: "/api/infra/lambdas/dirty",
    method: "GET",
    description: "Check which Lambdas have file changes since the last build. Useful to know which lambdas need rebuilding.",
    examples: [
      { title: "Check for dirty lambdas", request: "GET /api/infra/lambdas/dirty", notes: "Returns a map of lambda names to their dirty status and changed files" },
    ],
  },
  {
    path: "/api/infra/aws-lambdas",
    method: "GET",
    description: "List deployed AWS Lambda functions for the current environment. Fetches from AWS and caches.",
    queryParams: { refresh: "boolean – bypass cache and fetch from AWS" },
    examples: [
      { title: "List AWS lambdas (cached)", request: "GET /api/infra/aws-lambdas" },
      { title: "Force refresh from AWS", request: "GET /api/infra/aws-lambdas?refresh=true" },
    ],
  },
  {
    path: "/api/infra/aws-lambdas/invalidate",
    method: "POST",
    description: "Invalidate the AWS Lambdas cache",
  },
  {
    path: "/api/infra/aws-lambdas/:name",
    method: "GET",
    description: "Get details for a specific AWS Lambda with console URLs",
    params: { name: "string – AWS function name" },
  },
  {
    path: "/api/infra/frontend/env",
    method: "GET",
    description: "Read the frontend .env file (clients/web/.env)",
  },
  {
    path: "/api/infra/frontend/env",
    method: "PUT",
    description: "Write/overwrite the frontend .env file",
    body: { content: "string – .env file content" },
  },
  {
    path: "/api/infra/frontend/appsync",
    method: "GET",
    description: "Get available AppSync APIs for the current environment",
  },
  {
    path: "/api/infra/frontend/generate-env",
    method: "GET",
    description: "Auto-generate .env content for the current environment",
  },

  // ── Settings & Meta ──
  {
    path: "/api/version",
    method: "GET",
    description: "Get the application version",
  },
  {
    path: "/api/status",
    method: "GET",
    description: "Health check – shows Jira and Azure DevOps configuration status",
  },
  {
    path: "/api/setup",
    method: "PUT",
    description: "Save initial setup configuration for Jira and Azure DevOps",
    body: {
      jira: "{ host, email, apiToken }",
      azure: "{ organization, project, token, repositoryId }",
    },
  },
  {
    path: "/api/settings",
    method: "GET",
    description: "Get application settings (poll interval, protected environments)",
  },
  {
    path: "/api/settings",
    method: "PUT",
    description: "Update application settings",
    body: {
      pollIntervalMinutes: "number?",
      protectedEnvironments: "string[]?",
    },
  },
  {
    path: "/api/refresh",
    method: "POST",
    description: "Force refresh all caches and restart polling",
  },
  {
    path: "/api/cache/info",
    method: "GET",
    description: "Get cache status and expiration times for tickets and PRs",
  },
  {
    path: "/api/endpoints",
    method: "GET",
    description: "List all API endpoints with documentation (this endpoint)",
  },

  // ── Statistics ──
  {
    path: "/api/stats",
    method: "GET",
    description: "Get user stats (tickets, PRs) for the past 12 months",
  },
  {
    path: "/api/stats/cache-info",
    method: "GET",
    description: "Get stats cache status and TTL",
  },

  // ── JIRA ──
  {
    path: "/api/jira/search",
    method: "GET",
    description: "Search Jira issues by text query or key. The query is matched against ticket keys (exact prefix match) and free-text searched in summary/description.",
    queryParams: { q: "string – search query (ticket key or text)" },
    examples: [
      { title: "Search by ticket key", request: "GET /api/jira/search?q=PROJ-123", notes: "Matches tickets where key starts with the query" },
      { title: "Search by text", request: "GET /api/jira/search?q=login bug", notes: "Free-text search across summary and description fields" },
    ],
  },
  {
    path: "/api/jira/config",
    method: "GET",
    description: "Get JIRA board configuration",
  },
  {
    path: "/api/jira/config",
    method: "PUT",
    description: "Set JIRA board ID",
    body: { boardId: "number" },
  },
  {
    path: "/api/jira/attachment/*",
    method: "GET",
    description: "Proxy JIRA attachment downloads (avoids CORS)",
  },
  {
    path: "/api/jira/thumbnail/:id",
    method: "GET",
    description: "Proxy JIRA attachment thumbnail images",
    params: { id: "string – attachment ID" },
  },
  {
    path: "/api/jira/workflow",
    method: "GET",
    description: "Get available workflow statuses for the board",
  },
  {
    path: "/api/jira/tickets/:key",
    method: "GET",
    description: "Get a single Jira ticket with full details",
    params: { key: "string – ticket key" },
  },
  {
    path: "/api/jira/tickets/:key/transitions",
    method: "GET",
    description: "Get available status transitions for a ticket",
    params: { key: "string – ticket key" },
  },
  {
    path: "/api/jira/tickets/:key/description",
    method: "PUT",
    description: "Update a ticket's description",
    params: { key: "string – ticket key" },
    body: { description: "string – ADF or wiki markup" },
  },
  {
    path: "/api/jira/tickets/:key/transition",
    method: "POST",
    description: "Transition a ticket to a new status. Get available transitions first via GET /api/jira/tickets/:key/transitions.",
    params: { key: "string – ticket key" },
    body: { transitionId: "string – transition ID from available transitions" },
    examples: [
      { title: "Move ticket to In Progress", request: "POST /api/jira/tickets/PROJ-123/transition\n{\"transitionId\": \"21\"}", notes: "Transition IDs vary per workflow. Fetch /api/jira/tickets/PROJ-123/transitions first to get the correct ID." },
    ],
  },
  {
    path: "/api/jira/tickets/:key/assign-self",
    method: "POST",
    description: "Assign the ticket to the current user",
    params: { key: "string – ticket key" },
  },
  {
    path: "/api/jira/tickets/:key/unassign",
    method: "POST",
    description: "Unassign a ticket",
    params: { key: "string – ticket key" },
  },
  {
    path: "/api/jira/tickets/:key/comment",
    method: "POST",
    description: "Add a comment to a ticket. Optionally attach a link that renders as a card in Jira.",
    params: { key: "string – ticket key" },
    body: { body: "string – comment text", link: "string? – optional URL to link" },
    examples: [
      { title: "Add a comment", request: "POST /api/jira/tickets/PROJ-123/comment\n{\"body\": \"Fixed in PR #456\"}" },
      { title: "Comment with PR link", request: "POST /api/jira/tickets/PROJ-123/comment\n{\"body\": \"PR ready for review\", \"link\": \"https://dev.azure.com/org/project/_git/repo/pullrequest/456\"}" },
    ],
  },

  // ── Notes ──
  {
    path: "/api/notes",
    method: "GET",
    description: "List all notes, optionally filtered by type",
    queryParams: { type: "string? – note type filter" },
  },
  {
    path: "/api/notes/:type/:id",
    method: "GET",
    description: "Get a specific note",
    params: { type: "string – note type", id: "string – note ID" },
  },
  {
    path: "/api/notes/:type/:id",
    method: "PUT",
    description: "Save or update a note",
    params: { type: "string – note type", id: "string – note ID" },
    body: { content: "string – note content" },
  },
  {
    path: "/api/notes/:type/:id",
    method: "DELETE",
    description: "Delete a note",
    params: { type: "string – note type", id: "string – note ID" },
  },
  {
    path: "/api/notes/config",
    method: "GET",
    description: "Get notes configuration",
  },

  // ── Repositories ──
  {
    path: "/api/repos",
    method: "GET",
    description: "Get all registered repos and the currently selected repo",
  },
  {
    path: "/api/repos/scan",
    method: "POST",
    description: "Scan home directory for git repositories",
  },
  {
    path: "/api/repos/selected",
    method: "GET",
    description: "Get the currently selected repository",
  },
  {
    path: "/api/repos/selected",
    method: "PUT",
    description: "Set the selected repository",
    body: { repoId: "string – repo ID" },
  },
  {
    path: "/api/repos/:id/status",
    method: "GET",
    description: "Get git status and current branch for a repo",
    params: { id: "string – repo ID" },
  },

  // ── AI ──
  {
    path: "/api/ai/config",
    method: "GET",
    description: "Get AI configuration status and Claude availability",
  },
  {
    path: "/api/ai/config",
    method: "PUT",
    description: "Update AI configuration (model, API key, etc.)",
  },
  {
    path: "/api/ai/fix-ticket",
    method: "POST",
    description: "Start an AI fix job for a Jira ticket. Claude analyzes the ticket and generates code changes.",
    body: { ticketKey: "string – ticket key" },
    examples: [
      { title: "Fix a bug with AI", request: "POST /api/ai/fix-ticket\n{\"ticketKey\": \"PROJ-123\"}", notes: "Creates a job – stream output via GET /api/ai/fix-ticket/<jobId>/stream" },
    ],
  },
  {
    path: "/api/ai/start-ticket",
    method: "POST",
    description: "Start an AI session using the Claude Agent SDK. More advanced than fix-ticket.",
    body: { ticketKey: "string – ticket key" },
    examples: [
      { title: "Start AI agent on a ticket", request: "POST /api/ai/start-ticket\n{\"ticketKey\": \"PROJ-456\"}" },
    ],
  },
  {
    path: "/api/ai/start-ticket-test",
    method: "POST",
    description: "Test mode: start AI with manual ticket info (no Jira required)",
    body: { title: "string", description: "string" },
    examples: [
      { title: "Test AI without Jira", request: "POST /api/ai/start-ticket-test\n{\"title\": \"Fix login timeout\", \"description\": \"The login page times out after 5 seconds\"}" },
    ],
  },
  {
    path: "/api/ai/ticket-files/:ticketKey",
    method: "GET",
    description: "Read ticket-related files (start.md, plan.md, trace.md)",
    params: { ticketKey: "string – ticket key" },
  },
  {
    path: "/api/ai/session-transcript/:sessionId",
    method: "GET",
    description: "Read a Claude session JSONL transcript",
    params: { sessionId: "string – session UUID" },
  },
  {
    path: "/api/ai/fix-ticket/:jobId/stream",
    method: "GET",
    description: "SSE stream for AI fix job output",
    params: { jobId: "string – job UUID" },
    response: "text/event-stream",
  },

  // ── AppSync ──
  {
    path: "/api/appsync/config",
    method: "GET",
    description: "Get AppSync configuration status and schema detection",
  },
  {
    path: "/api/appsync/config",
    method: "PUT",
    description: "Update AppSync schema path and region",
    body: { schemaPath: "string?", region: "string?" },
  },
  {
    path: "/api/appsync/cognito/pools",
    method: "GET",
    description: "List available Cognito User Pools (cached)",
  },
  {
    path: "/api/appsync/cognito/pools/:poolId/clients",
    method: "GET",
    description: "List app clients for a Cognito User Pool",
    params: { poolId: "string – User Pool ID" },
  },
  {
    path: "/api/appsync/cognito/select",
    method: "POST",
    description: "Select a Cognito User Pool and Client for auth",
    body: { userPoolId: "string", clientId: "string" },
  },
  {
    path: "/api/appsync/cognito/select",
    method: "DELETE",
    description: "Clear selected Cognito User Pool and Client",
  },
  {
    path: "/api/appsync/schema",
    method: "GET",
    description: "Get the parsed GraphQL schema (cached)",
  },
  {
    path: "/api/appsync/schema/invalidate",
    method: "POST",
    description: "Invalidate the GraphQL schema cache",
  },
  {
    path: "/api/appsync/execute",
    method: "POST",
    description: "Execute a GraphQL query against AppSync. Requires prior Cognito authentication.",
    body: {
      query: "string – GraphQL query/mutation",
      variables: "object? – query variables",
    },
    examples: [
      { title: "Run a query", request: "POST /api/appsync/execute\n{\"query\": \"query { listUsers { id name } }\"}" },
      { title: "Run a query with variables", request: "POST /api/appsync/execute\n{\"query\": \"query GetUser($id: ID!) { getUser(id: $id) { id name } }\", \"variables\": {\"id\": \"123\"}}" },
    ],
  },
  {
    path: "/api/appsync/auth/login",
    method: "POST",
    description: "Login with Cognito credentials. Must select a User Pool and Client first via POST /api/appsync/cognito/select.",
    body: { email: "string", password: "string" },
    examples: [
      {
        title: "Full AppSync auth flow",
        description: "1. GET /api/appsync/cognito/pools → pick a pool\n2. GET /api/appsync/cognito/pools/:poolId/clients → pick a client\n3. POST /api/appsync/cognito/select {userPoolId, clientId}\n4. POST /api/appsync/auth/login {email, password}\n5. POST /api/appsync/execute {query}",
        notes: "Tokens are stored server-side. Use POST /api/appsync/auth/refresh to refresh expired tokens.",
      },
    ],
  },
  {
    path: "/api/appsync/auth/refresh",
    method: "POST",
    description: "Refresh the Cognito access token",
    body: { refreshToken: "string" },
  },
  {
    path: "/api/appsync/auth/logout",
    method: "POST",
    description: "Logout (client-side token clear)",
  },

  // ── C# Tests ──
  {
    path: "/api/ctest/projects",
    method: "GET",
    description: "List all C# test projects",
  },
  {
    path: "/api/ctest/tests/:project",
    method: "GET",
    description: "Discover tests for a C# project",
    params: { project: "string – project name" },
    queryParams: { rebuild: "boolean? – force rebuild before discovery" },
  },
  {
    path: "/api/ctest/run/:id/status",
    method: "GET",
    description: "Get structured test run status and results",
    params: { id: "string – job UUID" },
  },
  {
    path: "/api/ctest/run",
    method: "POST",
    description: "Run C# tests (creates a job). Runs via dotnet test.",
    body: {
      project: "string – project name",
      tests: "string[]? – specific test fully-qualified names to run",
      filter: "string? – dotnet test filter expression",
    },
    examples: [
      { title: "Run all tests in a project", request: "POST /api/ctest/run\n{\"project\": \"MyProject.Tests\"}" },
      { title: "Run specific tests", request: "POST /api/ctest/run\n{\"project\": \"MyProject.Tests\", \"tests\": [\"MyProject.Tests.LoginTests.ShouldAuthenticate\"]}" },
      { title: "Run with filter", request: "POST /api/ctest/run\n{\"project\": \"MyProject.Tests\", \"filter\": \"FullyQualifiedName~Login\"}" },
    ],
  },

  // ── Documentation ──
  {
    path: "/api/docs/tree",
    method: "GET",
    description: "Get the documentation directory tree structure",
  },
  {
    path: "/api/docs/file",
    method: "GET",
    description: "Read a documentation file by path",
    queryParams: { path: "string – relative file path" },
  },
  {
    path: "/api/docs/file",
    method: "PUT",
    description: "Write or update a documentation file",
    body: { path: "string – relative file path", content: "string" },
  },

  // ── E2E Tests ──
  {
    path: "/api/e2e/pipelines",
    method: "GET",
    description: "List all E2E test pipeline definitions",
  },
  {
    path: "/api/e2e/runs",
    method: "GET",
    description: "Get recent E2E test runs with details",
  },
  {
    path: "/api/e2e/runs/:runId/results",
    method: "GET",
    description: "Get test results for a specific E2E run",
    params: { runId: "string – pipeline run ID" },
  },

  // ── Playwright ──
  {
    path: "/api/playwright/specs",
    method: "GET",
    description: "List Playwright test spec files",
  },
  {
    path: "/api/playwright/run/:id/status",
    method: "GET",
    description: "Get Playwright test run status",
    params: { id: "string – job UUID" },
  },
  {
    path: "/api/playwright/run",
    method: "POST",
    description: "Run Playwright tests (creates a job)",
    body: {
      specs: "string[]? – specific spec files to run",
      headed: "boolean? – run in headed mode (shows browser window)",
    },
    examples: [
      { title: "Run all Playwright tests", request: "POST /api/playwright/run\n{}" },
      { title: "Run specific spec files", request: "POST /api/playwright/run\n{\"specs\": [\"login.spec.ts\", \"checkout.spec.ts\"]}" },
      { title: "Run in headed mode", request: "POST /api/playwright/run\n{\"headed\": true}", notes: "Opens a visible browser window – useful for debugging" },
    ],
  },
];
