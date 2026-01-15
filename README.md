# Buddy

A developer dashboard and CLI tool that integrates JIRA, Git, Azure DevOps, and AWS infrastructure management.

**📖 New to Buddy?** See [QUICKSTART.md](./QUICKSTART.md) for a 5-minute setup guide.

## Features

- 🖥️ **Web Dashboard** - Visual interface for tickets, PRs, Git, and infrastructure
- 🎫 **JIRA Integration** - Search issues, manage sprints, transition tickets
- 🌿 **Git Operations** - Branch management, commits, push/pull
- 🔄 **Pull Requests** - Create and manage Azure DevOps PRs
- 🏗️ **Infrastructure** - AWS Lambda builds, CDK deploys, CloudWatch logs
- 🤖 **MCP Server** - Use Buddy as a tool within Claude Code conversations
- 🪟 **Cross-Platform** - Build for Windows from WSL

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
  - Give it **Code (Read)** scope

## Web UI Pages

### Tickets (`/tickets`)

View your JIRA sprint tickets with linked pull requests:
- See ticket status, assignee, and story points
- Quick links to JIRA tickets and associated PRs
- Filter by status or search by ticket key/summary

### PRs (`/prs`)

View Azure DevOps pull requests:
- See PR status, reviewers, and vote status
- Links to associated JIRA tickets
- Filter by PR status (Active, Completed, Abandoned)

### Git (`/git`)

Manage your local Git repositories:
- Select and switch between repositories
- View current branch and status
- **Quick Checkout**: Fast checkout to base branches
  - `nextrelease` - New features or prepping for QA
  - `master` - Bug fixes only
- Fetch, pull, and view recent commits

### Infrastructure (`/infra`)

Manage AWS Lambda functions and CDK deployments:
- **Environments**: Switch between environments (e.g., `damien-1`, `devnext`)
- **Lambda Functions**: View, build, and deploy individual lambdas
- **Logs**: Tail CloudWatch logs in real-time
- **CDK Commands**: Run diff, deploy, and synth operations
- **Job Tracking**: Monitor build and deploy progress

**Protected Environments**: `devnext` and `master` are protected by default - deployments are disabled to prevent accidental changes.

### Settings (`/settings`)

Configure application settings:
- **Poll Interval**: How often to refresh ticket/PR data
- **Protected Environments**: Manage which environments block deployments
- **Cache Info**: View cache status and force refresh

---

## CLI Usage

For CLI usage instead of the web UI:

```bash
# Configure services via CLI
bun run index.ts jira config
bun run index.ts pr config

# Use the CLI
bun run index.ts jira ticket
bun run index.ts sc branch my-feature
bun run index.ts pr create
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
2. Go to **Advanced** tab → **Environment Variables**
3. Under "User variables", select **Path** → **Edit**
4. Click **New** → add `C:\Tools`
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
- `bud sc workflow <branch>` - Full workflow: branch → add → commit → push

### Pull Requests (`bud pr`)
- `bud pr create [target]` - Create PR with JIRA details
- `bud pr status [id]` - View PR status and build checks
- `bud pr config` - Configure Azure DevOps credentials

### MCP Server (`bud mcp`)
- `bud mcp serve` - Start MCP server (used by Claude Code)

## Build Scripts

```bash
# 🚀 ONE COMMAND - Does everything (build + install + sync)
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
