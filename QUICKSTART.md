# Quick Start Guide

Get Buddy running in 5 minutes.

---

## Option 1: Download Pre-built Binary (Recommended)

### 1. Download the Latest Release

Go to [GitHub Releases](../../releases) and download:
- **Windows**: `bud-windows-x64.zip`
- **Linux/WSL**: `bud-linux-x64.tar.gz`

### 2. Install

**Windows (PowerShell):**
```powershell
# Extract and move to a folder
mkdir C:\Tools -ErrorAction SilentlyContinue
Expand-Archive bud-windows-x64.zip -DestinationPath C:\Tools

# Add to PATH (run as Administrator, then restart terminal)
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";C:\Tools", "User")
```

**Linux/WSL:**
```bash
tar -xzf bud-linux-x64.tar.gz
sudo mv bud-linux /usr/local/bin/bud
```

### 3. Get Base Configuration

Contact Damien to get the base `~/.buddy.yaml` file with pre-configured organization settings.

Place it at:
- **Linux/WSL**: `~/.buddy.yaml`
- **Windows**: `C:\Users\YourUsername\.buddy.yaml`

### 4. Start the Web UI

```bash
bud ui
```

Open http://localhost:3456 in your browser.

### 5. Complete Setup Wizard

The wizard will ask for your personal tokens:

**JIRA API Token:**
1. Go to [Atlassian API Tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click "Create API token"
3. Copy the token

**Azure DevOps PAT:**
1. Go to [Azure DevOps Tokens](https://dev.azure.com/businessinfusions/_usersSettings/tokens)
2. Click "New Token"
3. Give it **Code (Read & Write)** scope
4. Copy the token

---

## Option 2: Build from Source

### 1. Clone and Install

```bash
git clone <repo-url>
cd buddy
bun install
```

### 2. Run the Web UI

```bash
bun run ui
```

Or with hot reload for development:
```bash
bun --hot ui/server.ts
```

### 3. Build Binaries

```bash
# Build for current platform
bun run build

# Build for Windows (from WSL)
bun run build:windows

# Build + install to Windows + sync config
bun run deploy
```

---

## Creating a Release

Releases are automated via GitHub Actions.

### To Create a New Release:

```bash
# 1. Commit your changes
git add .
git commit -m "Your changes"

# 2. Tag with version
git tag v1.0.0

# 3. Push with tags
git push origin main --tags
```

GitHub Actions will automatically:
1. Build binaries for Linux and Windows
2. Create a GitHub release with binaries attached
3. Generate release notes from commits

### Version Naming:

| Tag | Type | Notes |
|-----|------|-------|
| `v1.0.0` | Stable | Full release |
| `v1.0.0-beta.1` | Beta | Marked as pre-release |
| `v1.0.0-alpha.1` | Alpha | Marked as pre-release |

### Manual Build (if needed):

```bash
# Build both platforms
bun run build
bun run build:windows

# Binaries are created at:
# - ./bud-linux (Linux)
# - ./bud-windows.exe (Windows)
```

---

## Using Buddy

### Web UI (Recommended)

```bash
bud ui
```

**Pages:**
- `/dashboard` - Overview: issues, PRs, reviews, team activity
- `/stats` - Metrics dashboard (tickets and PRs over 12 months)
- `/tickets` - JIRA sprint tickets with linked PRs
- `/tickets/PROJ-123` - Full ticket detail with comments, attachments, notes
- `/prs` - Azure DevOps pull requests with search and filters
- `/prs/create` - Create a new PR with JIRA integration
- `/prs/123` - PR detail with reviewers, threads, build checks
- `/git` - Repository management, branch switching, checkout
- `/infra` - Lambda builds, CDK deploys, frontend builds, CloudWatch logs
- `/appsync` - GraphQL API explorer with Cognito auth
- `/jobs` - Monitor running builds, deploys, and test jobs
- `/tests` - C# tests, Playwright tests, E2E pipeline results
- `/ai-docs` - AI features and documentation
- `/settings` - Poll interval, protected environments, cache

### CLI Commands

```bash
# JIRA
bud jira browse          # Browse tickets in TUI
bud jira ticket          # Select ticket and create branch

# Git
bud sc branch my-feature # Create a branch
bud sc push              # Push to remote

# Pull Requests
bud pr create            # Create PR with JIRA details
bud pr status            # View PR status

# Repositories
bud repo scan            # Scan for git repos
```

---

## API Documentation

The API is self-documenting. With the server running, hit:

```
GET http://localhost:3456/api/endpoints
```

This returns a JSON catalog of all 90+ API endpoints with descriptions, parameters, and expected request bodies.

---

## MCP Server (Claude Code Integration)

Use Buddy as a tool within Claude Code:

```powershell
# Windows
claude mcp add buddy -- C:\Tools\bud.exe mcp serve
```

```bash
# Linux/WSL
claude mcp add buddy -- bud mcp serve
```

Now ask Claude things like:
- "Show me the active sprint issues"
- "Create a branch for PROJ-123"
- "What's my PR status?"

---

## Troubleshooting

### "bud: command not found"
Make sure the binary is in your PATH and restart your terminal.

### JIRA/Azure DevOps errors
Check your tokens haven't expired. Regenerate them if needed.

### Web UI won't start
Check if port 3456 is already in use:
```bash
lsof -i :3456  # Linux/WSL
netstat -ano | findstr :3456  # Windows
```

---

## More Info

- [README.md](./README.md) - Full documentation
- [INSTALL.md](./INSTALL.md) - Detailed installation guide
- [MCP_SETUP.md](./MCP_SETUP.md) - Claude Code integration details
- [CLAUDE.md](./CLAUDE.md) - Architecture and coding conventions
