#!/bin/bash

set -e

echo "🔨 Building Buddy for Windows..."
bun run build:windows

# Detect Windows username
WINDOWS_USER=$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r\n' || echo "")

if [ -z "$WINDOWS_USER" ]; then
    echo "❌ Could not detect Windows username"
    echo "Please manually copy dist/bud.exe to your Windows PATH"
    exit 1
fi

echo "✓ Detected Windows user: $WINDOWS_USER"

# Set target directory in Windows
WIN_INSTALL_DIR="/mnt/c/Users/$WINDOWS_USER/bin"
WIN_PATH_DISPLAY="C:\\Users\\$WINDOWS_USER\\bin"

# Create the directory if it doesn't exist
mkdir -p "$WIN_INSTALL_DIR"

# Copy the executable
echo "📦 Installing to $WIN_PATH_DISPLAY..."

# Try to copy, if it fails, provide helpful message
if ! cp dist/bud.exe "$WIN_INSTALL_DIR/bud.exe" 2>/dev/null; then
    echo ""
    echo "⚠️  Could not copy file - it may be in use."
    echo ""
    echo "Please close any running instances of 'bud' in PowerShell/CMD, then try again."
    echo ""
    echo "Or manually copy the file:"
    echo "  1. Close all PowerShell/CMD windows running 'bud'"
    echo "  2. Copy dist/bud.exe to $WIN_PATH_DISPLAY"
    echo ""
    echo "Alternative: Copy manually from Windows:"
    echo "  Copy from: \\\\wsl\$\\Ubuntu\\home\\$USER\\work\\buddy\\dist\\bud.exe"
    echo "  Copy to: $WIN_PATH_DISPLAY\\bud.exe"
    exit 1
fi

echo ""
echo "✅ Buddy installed successfully!"
echo ""
echo "📍 Location: $WIN_PATH_DISPLAY\\bud.exe"
echo ""

# Check if the directory is in PATH
if cmd.exe /c "echo %PATH%" 2>/dev/null | grep -qi "$(echo $WIN_PATH_DISPLAY | sed 's/\\/\\\\/g')"; then
    echo "✓ $WIN_PATH_DISPLAY is already in your Windows PATH"
    echo ""
    echo "You can now use 'bud' from PowerShell or CMD!"
else
    echo "⚠️  $WIN_PATH_DISPLAY is NOT in your Windows PATH yet."
    echo ""
    echo "To add it to your PATH, run this in PowerShell (as Administrator):"
    echo ""
    echo "  [Environment]::SetEnvironmentVariable("
    echo "    \"Path\","
    echo "    [Environment]::GetEnvironmentVariable(\"Path\", \"User\") + \";$WIN_PATH_DISPLAY\","
    echo "    \"User\""
    echo "  )"
    echo ""
    echo "Or manually:"
    echo "  1. Open 'Edit environment variables for your account'"
    echo "  2. Select 'Path' under User variables"
    echo "  3. Click 'Edit' -> 'New'"
    echo "  4. Add: $WIN_PATH_DISPLAY"
    echo "  5. Click OK and restart your terminal"
fi

# Handle config file
WSL_CONFIG="$HOME/.buddy.yaml"
WIN_CONFIG="/mnt/c/Users/$WINDOWS_USER/.buddy.yaml"
WIN_CONFIG_DISPLAY="C:\\Users\\$WINDOWS_USER\\.buddy.yaml"

echo "⚙️  Syncing config file..."

if [ -f "$WSL_CONFIG" ]; then
    cp "$WSL_CONFIG" "$WIN_CONFIG"
    echo "✓ Copied config from WSL to $WIN_CONFIG_DISPLAY"
elif [ -f "$WIN_CONFIG" ]; then
    echo "✓ Windows config already exists at $WIN_CONFIG_DISPLAY"
else
    echo "ℹ️  No config file found. Run 'bud jira config' and 'bud pr config' to set up."
fi

echo ""
echo "✅ Installation complete!"
echo ""
echo "📝 To update Buddy later, just run:"
echo "   bun run deploy"
echo ""
echo "💡 Tips:"
echo "   • Your config is at $WIN_CONFIG_DISPLAY"
echo "   • WSL config (~/.buddy.yaml) syncs automatically on deploy"
echo "   • Use 'bun run sync:config' to sync config without rebuilding"
echo ""
