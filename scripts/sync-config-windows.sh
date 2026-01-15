#!/bin/bash

set -e

# Detect Windows username
WINDOWS_USER=$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r\n' || echo "")

if [ -z "$WINDOWS_USER" ]; then
    echo "❌ Could not detect Windows username"
    exit 1
fi

WSL_CONFIG="$HOME/.buddy.yaml"
WIN_CONFIG="/mnt/c/Users/$WINDOWS_USER/.buddy.yaml"
WIN_CONFIG_DISPLAY="C:\\Users\\$WINDOWS_USER\\.buddy.yaml"

echo "🔄 Syncing config file..."

if [ -f "$WSL_CONFIG" ]; then
    cp "$WSL_CONFIG" "$WIN_CONFIG"
    echo "✓ Copied WSL config to $WIN_CONFIG_DISPLAY"
    echo ""
    echo "Config synced successfully!"
elif [ -f "$WIN_CONFIG" ]; then
    cp "$WIN_CONFIG" "$WSL_CONFIG"
    echo "✓ Copied Windows config to ~/.buddy.yaml"
    echo ""
    echo "Config synced successfully!"
else
    echo "❌ No config file found in either location"
    echo ""
    echo "Run 'bud jira config' or 'bud pr config' to create one."
    exit 1
fi
