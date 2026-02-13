# Buddy

A developer dashboard and CLI tool that integrates JIRA, Git, Azure DevOps, and AWS infrastructure management.

**New to Buddy?** See [QUICKSTART.md](./QUICKSTART.md) for a 5-minute setup guide.

## Features

- **Web Dashboard** - Visual interface for tickets, PRs, Git, infrastructure, and more
- **JIRA Integration** - Search issues, manage sprints, transition tickets, add comments
- **Git Operations** - Branch management, commits, push/pull, ticket-based checkout
- **Pull Requests** - Create and manage Azure DevOps PRs with reviewer workflows
- **Infrastructure** - AWS Lambda builds, CDK deploys, CloudWatch logs, environment management
- **Frontend Builds** - Build and deploy frontend clients (web, payment portal)
- **AppSync** - GraphQL API explorer with Cognito auth and schema browsing
- **AI Integration** - Claude-powered ticket fixing and code generation
- **Testing** - C# test runner, Playwright browser tests, E2E pipeline monitoring
- **Documentation** - Built-in docs viewer and editor
- **MCP Server** - Use Buddy as a tool within Claude Code conversations
- **Cross-Platform** - Build for Windows from WSL

## Quick Start

```bash
# If using pre-built binary:
bud ui

# If running from source:
bun install
bun run ui
```

The UI will start at `http://localhost:3456`. On first launch, you'll see a setup wizard.

## Web UI Setup

### 1. Get the Base Configuration

Contact Damien to get the base `~/.buddy.yaml` configuration file. This file contains pre-configured defaults for your organization.

### 2. Complete the Setup Wizard

On first launch, the setup wizard will guide you through configuring:

**JIRA**
- Host: Your Atlassian domain (e.g., `your-company.atlassian.net`)
- Email: Your Atlassian account email
- API Token: Create one at [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens)

**Azure DevOps**
- Organization, Project, and Repository ID are pre-filled from your base config
- PAT Token: Create one at [Azure DevOps Tokens](https://businessinfusions.visualstudio.com/_usersSettings/tokens)
  - Click "New Token" at the top right
  - Give it **Code (Read & Write)** scope

## Web UI Pages

### Dashboard (`/dashboard`)

Overview of your work across all integrations:
- Assigned issues, your PRs, PRs to review
- Failed builds, stale PRs, blocked PRs
- Team overview and recent activity

### Stats (`/stats`)

Metrics dashboard showing tickets and PRs over the past 12 months with monthly breakdowns.

### Tickets (`/tickets`)

View your JIRA sprint tickets with linked pull requests:
- See ticket status, assignee, and story points
- Quick links to JIRA tickets and associated PRs
- Filter by status or search by ticket key/summary
- Click into a ticket for full detail view with description, comments, attachments, and notes

### PRs (`/prs`)

View Azure DevOps pull requests:
- See PR status, reviewers, and vote status
- Links to associated JIRA tickets
- Filter by PR status (Active, Completed, Abandoned)
- Search by title, branch, or author
- Click into a PR for full detail with threads, build checks, and reviewer management
- Create new PRs from the `/prs/create` page

### Git (`/git`)

Manage your local Git repositories:
- Select and switch between repositories
- View current branch and status
- **Quick Checkout**: Fast checkout to base branches
  - `nextrelease` - New features or prepping for QA
  - `master` - Bug fixes only
- Checkout branches from tickets or PRs
- Fetch, pull, and view recent commits

### Infrastructure (`/infra`)

Manage AWS Lambda functions and CDK deployments across three tabs:

**Build tab:**
- View deployed CloudFormation stacks with diff and deploy actions
- Lambda functions grouped by type (.NET, JS, Python, TypeScript Edge)
- Build individual lambdas, by type, or all at once
- **Build & Deploy BE** - Build all lambdas then deploy the backend CDK stack
- **Build & Deploy FE** - Build the web client then deploy the frontend CDK stack
- Monitor build progress with real-time streaming output

**AWS Lambdas tab:**
- Browse all deployed Lambda functions in the current environment
- Search, view details, deploy code updates, tail CloudWatch logs

**Frontend tab:**
- **Build Web** and **Build Payment Portal** buttons for `clients/web` and `clients/paymentportal`
- Auto-generate and save `.env` configuration for the current environment
- View available AppSync APIs and copy URLs

**Protected Environments**: `devnext` and `master` are protected by default - deployments are disabled to prevent accidental changes.

### AppSync (`/appsync`)

GraphQL API explorer:
- Browse parsed GraphQL schema (queries, mutations, subscriptions)
- Execute queries with variable support
- Cognito authentication (login, token refresh)
- User Pool and Client selection

### Jobs (`/jobs`)

Monitor all running and recent jobs:
- Real-time streaming output for builds, deploys, and tests
- Cancel running jobs
- Approval flow for CDK deployments (diff review before deploy)

### Tests (`/tests`)

Testing hub with multiple test runners:
- **C# Tests** - Discover and run .NET test projects
- **Playwright** - Run browser automation tests (headed or headless)
- **E2E Pipelines** - Monitor Azure DevOps E2E test pipeline runs and results

### AI (`/ai-docs`)

AI-powered features:
- Documentation viewer and editor
- AI ticket fixing with Claude Agent SDK
- Session transcript viewer

### Settings (`/settings`)

Configure application settings:
- **Poll Interval**: How often to refresh ticket/PR data
- **Protected Environments**: Manage which environments block deployments
- **Cache Info**: View cache status and force refresh

---

## CLI Usage

```bash
# Configure services via CLI
bud jira config
bud pr config

# Use the CLI
bud jira ticket
bud sc branch my-feature
bud pr create
```

## Installation

### Option 1: Download Pre-built Binary (Recommended)

Download the latest release from [GitHub Releases](../../releases):

**Linux/WSL:**
```bash
# Download and extract
tar -xzf bud-linux-x64.tar.gz

# Move to a directory in your PATH
sudo mv bud-linux /usr/local/bin/bud

# Run the Web UI
bud ui
```

**Windows:**
```powershell
# 1. Extract bud-windows-x64.zip

# 2. Create a folder for the binary (if it doesn't exist)
mkdir C:\Tools

# 3. Move and rename the executable
move bud-windows.exe C:\Tools\bud.exe

# 4. Add to PATH (run PowerShell as Administrator):
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\Tools", "User")

# 5. Restart your terminal, then run:
bud ui
```

Or add to PATH via GUI:
1. Press `Win + R`, type `sysdm.cpl`, press Enter
2. Go to **Advanced** tab > **Environment Variables**
3. Under "User variables", select **Path** > **Edit**
4. Click **New** > add `C:\Tools`
5. Click **OK** on all dialogs
6. Restart your terminal

### Option 2: Build from Source

See [INSTALL.md](./INSTALL.md) for detailed instructions, including:
- Building for Windows from WSL
- Adding to your PATH
- Config file syncing

## MCP Server (Claude Code Integration)

Buddy can run as an MCP server, allowing Claude Code to use it as a set of tools during conversations.

See [MCP_SETUP.md](./MCP_SETUP.md) for setup instructions.

## Available Commands

### JIRA (`bud jira`)
- `bud jira ticket [ticket]` - Select ticket and create branch
- `bud jira browse` - TUI for browsing JIRA tickets
- `bud jira move [ticket] [status]` - Transition ticket status
- `bud jira config` - Configure JIRA credentials

### Git (`bud sc`)
- `bud sc branch <name>` - Create a new branch
- `bud sc add [files...]` - Stage files for commit
- `bud sc push` - Push to remote
- `bud sc workflow <branch>` - Full workflow: branch > add > commit > push

### Pull Requests (`bud pr`)
- `bud pr create [target]` - Create PR with JIRA details
- `bud pr status [id]` - View PR status and build checks
- `bud pr config` - Configure Azure DevOps credentials

### MCP Server (`bud mcp`)
- `bud mcp serve` - Start MCP server (used by Claude Code)

### Repositories (`bud repo`)
- `bud repo scan` - Scan for git repositories

### Web UI (`bud ui`)
- `bud ui` - Start the web dashboard

## API Documentation

The API is self-documenting. Hit `GET /api/endpoints` for a full JSON catalog of all 90+ endpoints with descriptions, parameters, and expected request bodies.

## Build Scripts

```bash
# One command - build + install + sync
bun run deploy

# Or use individual commands:
bun run build              # Build for Linux/WSL
bun run build:windows      # Build for Windows only
bun run install:windows    # Build + install to Windows + sync config
bun run sync:config        # Sync config only (no rebuild)
```

## Configuration

Configuration is stored in `~/.buddy.yaml` (or `C:\Users\YourUsername\.buddy.yaml` on Windows).

Example config:
```yaml
jira:
  host: your-company.atlassian.net
  email: your-email@example.com
  apiToken: your-api-token
  boardId: 123  # Optional: specific JIRA board

azureDevOps:
  organization: businessinfusions
  project: 2Cassadol
  token: your-pat-token
  repositoryId: 2Cassadol

git:
  baseBranches:
    azure: main

settings:
  pollIntervalMinutes: 5
  protectedEnvironments:
    - devnext
    - master

ui:
  notesDir: ~/notes  # Optional: directory for ticket notes
```

## Development

This project uses [Bun](https://bun.com) as the JavaScript runtime.

```bash
# Run Web UI with hot reload
bun --hot ui/server.ts

# Run CLI directly
bun run index.ts --help

# Type checking
bun run tsc --noEmit
```

See [CLAUDE.md](./CLAUDE.md) for coding conventions and architecture details.

## Creating a Release

Releases are automated via GitHub Actions. To create a new release:

```bash
# Tag with version (triggers build)
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions will automatically:
1. Build binaries for Linux and Windows
2. Create a release with the binaries attached
3. Generate release notes from commits

**Version naming:**
- `v1.0.0` - Stable release
- `v1.0.0-beta.1` - Beta release (marked as pre-release)
- `v1.0.0-alpha.1` - Alpha release (marked as pre-release)

## License

Private project.
