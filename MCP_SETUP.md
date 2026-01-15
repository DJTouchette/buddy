# Buddy MCP Server Setup

This guide explains how to use Buddy as an MCP (Model Context Protocol) server with Claude Code.

## What is MCP?

MCP (Model Context Protocol) allows Claude Code and other AI assistants to use your Buddy CLI as a set of tools during conversations. This means Claude can:

- Search and manage your JIRA tickets
- Create git branches from tickets
- Manage pull requests in Azure DevOps
- Execute complete workflows (ticket → branch → PR)

All through natural conversation!

## Installation

### 1. Install Buddy CLI

Make sure you have Buddy installed and configured:

```bash
# Install dependencies
bun install

# Configure JIRA (if not already done)
bun ./index.ts jira config

# Configure Azure DevOps (if not already done)
bun ./index.ts pr config
```

### 2. Build for Windows (WSL Users)

If you're using Bun on WSL and want to use Buddy from Windows PowerShell/CMD:

```bash
# One command to build and install to Windows
bun run install:windows
```

This will:
- Build a native Windows executable (`bud.exe`)
- Install it to `C:\Users\YourUsername\bin\`
- Provide instructions for adding to your Windows PATH

After adding to PATH, you can use `bud` directly from PowerShell or CMD!

**Note:** For MCP with Claude Desktop on Windows, you'll need to register the Windows executable path (see step 2b below).

### 2a. Register Buddy (Linux/WSL)

Run the following command to add Buddy as an MCP server:

```bash
claude mcp add --transport stdio buddy -- bun $(pwd)/index.ts mcp serve
```

### 2b. Register Buddy (Windows)

If you built for Windows, use the Windows executable path:

```powershell
# In PowerShell (adjust path to match your username)
claude mcp add --transport stdio buddy -- C:\Users\YourUsername\bin\bud.exe mcp serve
```

This registers Buddy so Claude Code can access it during conversations.

### 3. Verify Installation

Check that Buddy is registered:

```bash
claude mcp list
```

You should see `buddy` in the list of MCP servers.

## Available MCP Tools

Once registered, Claude Code can use these Buddy tools:

### JIRA Tools

- **jira_search_issues** - Search JIRA issues using JQL
- **jira_get_active_sprint** - Get issues in the active sprint
- **jira_get_issue** - Get detailed info about a specific issue
- **jira_get_my_issues** - Get your assigned unresolved issues
- **jira_transition_issue** - Move an issue to a different status

### Git Tools

- **git_get_status** - Get repository status
- **git_get_current_branch** - Get current branch name
- **git_create_branch** - Create a new branch
- **git_add_files** - Stage files for commit
- **git_commit** - Commit staged changes
- **git_push** - Push commits to remote

### Pull Request Tools

- **pr_create** - Create a pull request in Azure DevOps
- **pr_get_status** - Get PR status and build checks

### Workflow Tools

- **workflow_ticket_to_branch** - Create a git branch from a JIRA ticket
- **workflow_create_pr_from_ticket** - Create a PR with JIRA ticket details

## Usage Examples

Once Buddy is registered as an MCP server, you can ask Claude Code to use it:

```
> Show me all the issues in the active sprint

> Create a branch for ticket PROJ-123

> What's the status of my current PR?

> Create a pull request for the current branch

> Transition PROJ-456 to "In Progress"

> Show me my assigned JIRA tickets
```

Claude will automatically use the appropriate Buddy tools to complete these requests.

## Testing the MCP Server

You can manually test the MCP server by running:

```bash
bun ./index.ts mcp serve
```

This starts the server in stdio mode. It will wait for JSON-RPC messages on stdin. Press Ctrl+C to stop.

## Troubleshooting

### "JIRA is not configured" Error

Run the JIRA configuration command:
```bash
bun ./index.ts jira config
```

### "Azure DevOps is not configured" Error

Run the PR configuration command:
```bash
bun ./index.ts pr config
```

### "Not in a git repository" Error

Make sure you're running Claude Code from within a git repository when using git-related tools.

### Server Not Responding

1. Check that the server is registered:
   ```bash
   claude mcp list
   ```

2. Remove and re-add the server:
   ```bash
   claude mcp remove buddy
   claude mcp add --transport stdio buddy -- bun $(pwd)/index.ts mcp serve
   ```

3. Check the server starts without errors:
   ```bash
   bun ./index.ts mcp serve
   ```
   (Press Ctrl+C to stop)

## Architecture

Buddy operates in two modes:

1. **CLI Mode** - Direct command-line usage: `bud jira ticket`, `bud sc branch`, etc.
2. **MCP Server Mode** - Exposes tools to Claude Code via stdio transport

Both modes share the same underlying services and business logic, ensuring feature parity.

## Configuration

Buddy stores configuration in `~/.buddy.yaml`. This includes:

- JIRA credentials (host, email, API token)
- Azure DevOps credentials (organization, project, token, repository ID)
- Git configuration (base branches, etc.)

The MCP server reads this configuration automatically when tools are invoked.

## Security

- All credentials are stored locally in `~/.buddy.yaml`
- The MCP server runs locally on your machine
- No data is sent to external services except JIRA and Azure DevOps APIs
- Communication with Claude Code uses stdio (standard input/output)

## Uninstalling

To remove Buddy as an MCP server:

```bash
claude mcp remove buddy
```

This removes the MCP server registration. Your Buddy CLI will still work normally.
