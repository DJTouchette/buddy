# Installation Guide

## Quick Start

### WSL/Linux

```bash
# Install dependencies
bun install

# Use directly with Bun
bun ./index.ts --help

# Or build for native execution
bun run build
./dist/bud --help
```

## Windows Build (from WSL)

If you're developing on WSL but want to use Buddy from Windows PowerShell/CMD:

```bash
# 🚀 ONE COMMAND - Does everything!
bun run deploy
```

This will:
1. Build a native Windows executable (`bud.exe`)
2. Copy it to `C:\Users\YourUsername\bin\bud.exe`
3. Sync your config file (`~/.buddy.yaml`) to Windows
4. Provide instructions for adding to your Windows PATH

**Aliases**: `bun run install:windows` does the same thing

### Add to Windows PATH

After running the install script, add the directory to your PATH:

**Option 1: PowerShell (as Administrator)**
```powershell
[Environment]::SetEnvironmentVariable(
  "Path",
  [Environment]::GetEnvironmentVariable("Path", "User") + ";C:\Users\YourUsername\bin",
  "User"
)
```

**Option 2: GUI**
1. Open "Edit environment variables for your account"
2. Select "Path" under User variables
3. Click "Edit" → "New"
4. Add: `C:\Users\YourUsername\bin`
5. Click OK and restart your terminal

### Verify Installation

```powershell
# In PowerShell or CMD
bud --help
```

## Configuration

After installation, configure your services:

```bash
# Configure JIRA
bud jira config

# Configure Azure DevOps
bud pr config

# Scan for git repositories
bud repo scan
```

Configuration is stored in `~/.buddy.yaml`. See [CLAUDE.md](./CLAUDE.md) for architecture details.

## MCP Server Setup

To use Buddy with Claude Code, see [MCP_SETUP.md](./MCP_SETUP.md).

## Config File Syncing

Your Buddy config (`~/.buddy.yaml`) is automatically synced between WSL and Windows:

- **During install**: `bun run install:windows` copies WSL config to Windows
- **Manual sync**: `bun run sync:config` syncs config in either direction

The config will be located at:
- **WSL**: `~/.buddy.yaml`
- **Windows**: `C:\Users\YourUsername\.buddy.yaml`

If you make changes to your config in one environment, just run `bun run sync:config` to sync to the other.

## Updating

When you make changes to Buddy, rebuild and reinstall:

```bash
# 🚀 ONE COMMAND - Rebuild everything
bun run deploy

# Or just sync config without rebuilding
bun run sync:config
```

The `deploy` command rebuilds, installs to Windows, and syncs your config automatically.

## Manual Build

If you need more control:

```bash
# Build for Windows
bun run build:windows

# Output: dist/bud.exe
# Manually copy to your desired location
```

## Troubleshooting

### "Could not detect Windows username"

The install script needs to detect your Windows username. Make sure you're running from WSL with proper Windows interop enabled.

You can manually copy the built executable:
```bash
cp dist/bud.exe /mnt/c/Users/YourUsername/bin/bud.exe
```

### "bud: command not found" after installation

Make sure:
1. `C:\Users\YourUsername\bin` is in your Windows PATH
2. You've restarted your terminal/PowerShell
3. The file `bud.exe` exists in that directory

Check with:
```powershell
Get-ChildItem C:\Users\YourUsername\bin\bud.exe
echo $env:Path
```
