# Buddy

Developer dashboard and CLI tool that integrates JIRA, Azure DevOps, Git, and AWS infrastructure management into a single web UI and command-line interface.

## Tech Stack

- **Runtime**: Bun (not Node.js)
- **Frontend**: React 19, bundled by Bun (no Vite, no Webpack)
- **Backend**: `Bun.serve()` (no Express)
- **Database**: `bun:sqlite` (no better-sqlite3)
- **Config**: YAML at `~/.buddy.yaml`
- **AI**: Anthropic Claude Agent SDK

## Bun Rules

Default to Bun for everything:

- `bun <file>` not `node` / `ts-node`
- `bun test` not `jest` / `vitest`
- `bun build` not `webpack` / `esbuild`
- `bun install` not `npm install` / `yarn install`
- `bun run <script>` not `npm run`
- Bun auto-loads `.env` — don't use `dotenv`
- `Bun.file` over `node:fs` readFile/writeFile
- `Bun.$\`cmd\`` over `execa`
- `WebSocket` built-in — don't use `ws`
- `bun:sqlite` — don't use `better-sqlite3`

## Project Structure

```
index.ts                  # CLI entry point (yargs)
ui/
  server.ts               # Bun.serve() — HTTP server, polling, caching
  frontend.tsx             # React app entry + routing
  routes.ts                # Frontend route matching (parameterized)
  index.html               # HTML shell
  styles.css               # Styles
  api/                     # API route modules (one file per domain)
    index.ts               # Composes all route modules via createApiRoutes()
    context.ts             # ApiContext interface (DI for route handlers)
    helpers.ts             # handler() wrapper, errorResponse()
    endpoints.ts           # API endpoint documentation (served at GET /api/endpoints)
    settings.ts            # /api/version, /api/status, /api/settings, /api/endpoints
    dashboard.ts           # /api/dashboard/*
    tickets.ts             # /api/tickets/*
    prs.ts                 # /api/prs/*
    jira.ts                # /api/jira/*
    git.ts                 # /api/git/*
    infra.ts               # /api/infra/*
    jobs.ts                # /api/jobs/*, /api/logs/*
    jobs/                  # Job execution engine
      executor.ts          # Strategy dispatcher
      streamProcess.ts     # Process output streaming + ANSI stripping
      strategies/          # One strategy class per job type
        types.ts           # JobStrategy, JobParams, JobContext interfaces
        BuildJobStrategy.ts
        CdkJobStrategy.ts
        DeployLambdaJobStrategy.ts
        TailLogsJobStrategy.ts
        FrontendBuildJobStrategy.ts
        BuildDeployAllJobStrategy.ts
    ai.ts                  # /api/ai/*
    appsync.ts             # /api/appsync/*
    ctest.ts               # /api/ctest/*
    docs.ts                # /api/docs/*
    e2e.ts                 # /api/e2e/*
    playwright.ts          # /api/playwright/*
    repos.ts               # /api/repos/*
    stats.ts               # /api/stats/*
    notes.ts               # /api/notes/*
  pages/                   # React page components
  components/              # Reusable React components
  hooks/                   # Custom React hooks
  shared/                  # Shared frontend utilities
services/                  # Core business logic
  configService.ts         # YAML config (~/.buddy.yaml)
  cacheService.ts          # SQLite cache (~/.buddy/cache.db)
  jobService.ts            # Job queue + history (SQLite ~./buddy/jobs.db)
  jiraService.ts           # JIRA REST API
  azureDevOpsService.ts    # Azure DevOps REST API
  linkingService.ts        # Correlates tickets <-> PRs
  infraService.ts          # AWS CloudFormation, Lambda, CloudWatch, AppSync
  lambdaBuilderService.ts  # Lambda zip packaging + deployment
  repoService.ts           # Git repo discovery + scanning
  sourceControlService.ts  # Git operations (branch, commit, push)
  notesService.ts          # File-based markdown notes (~/.buddy/notes/)
  aiService.ts             # Claude Agent SDK integration
commands/                  # CLI commands (yargs)
```

## Architecture Patterns

- **Service-Oriented**: Each integration (JIRA, Azure, AWS) is a service class
- **Lazy Service Loading**: Services init on first use via `getServices()`
- **Cache-First**: API endpoints check SQLite cache before external APIs
- **Background Polling**: Configurable interval refreshes tickets/PRs/dashboard
- **Job Strategy Pattern**: `ui/api/jobs/executor.ts` dispatches to strategy classes in `strategies/`
- **Approval Flow**: CDK deploys use `awaiting_approval` status + `sendApprovalResponse()`
- **SSE Streaming**: Job output and dashboard updates stream via Server-Sent Events
- **Protected Environments**: Whitelist prevents deploys to prod environments

## Adding API Routes

Routes are defined in files under `ui/api/`. Each file exports a function that takes `ApiContext` and returns a route object:

```ts
export function myRoutes(ctx: ApiContext) {
  return {
    "/api/my-thing": {
      GET: handler(async (req: Request) => {
        return Response.json({ data: "hello" });
      }),
      POST: handler(async (req: Request) => {
        const body = await req.json();
        return Response.json({ success: true });
      }),
    },
  };
}
```

Register new route modules in `ui/api/index.ts` by importing and spreading into `createApiRoutes()`.

## Adding Job Types

1. Add the type string to `JobType` union in `services/jobService.ts`
2. Create a strategy class in `ui/api/jobs/strategies/` implementing `JobStrategy`
3. Register it in `ui/api/jobs/executor.ts` strategies map
4. Add any new `JobParams` fields to `ui/api/jobs/strategies/types.ts`
5. Pass params from `ui/api/jobs.ts` in the `executeJob` call

## API Endpoint Documentation

**IMPORTANT**: When you add, remove, or modify any API endpoint, you MUST also update `ui/api/endpoints.ts` to keep the documentation in sync. This file is served at `GET /api/endpoints` and is the single source of truth for API documentation.

Each endpoint entry has:
```ts
{
  path: "/api/example/:id",      // Route pattern
  method: "GET",                  // HTTP method
  description: "What it does",    // Human-readable description
  params?: { id: "string" },      // URL path parameters
  queryParams?: { q: "string" },  // Query string parameters
  body?: { name: "string" },      // Request body fields
  response?: "text/event-stream", // Non-JSON response types (SSE, etc.)
}
```

## Running

```sh
# Development (hot reload)
bun --hot ui/server.ts

# CLI
bun index.ts ui          # Start web server
bun index.ts jira ticket # JIRA commands
bun index.ts sc branch   # Source control
bun index.ts pr create   # PR management
bun index.ts mcp serve   # MCP server for Claude Code

# Build binary
bun build ./index.ts --compile --target=bun --outfile=dist/bud
```

## Testing

```ts
import { test, expect } from "bun:test";

test("example", () => {
  expect(1).toBe(1);
});
```

Run with `bun test`.

## Frontend

Uses HTML imports with `Bun.serve()`. No Vite. HTML files import `.tsx`/`.jsx`/`.js` directly and Bun bundles automatically. `<link>` tags bundle CSS.

```ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => Response.json({ id: req.params.id }),
    },
  },
  development: { hmr: true, console: true },
})
```

For more Bun API details: `node_modules/bun-types/docs/**.md`
