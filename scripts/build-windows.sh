#!/bin/bash
# Build for Windows - uses Windows Bun if available for proper native module bundling

set -e

echo "🔨 Building Buddy for Windows..."

# Try to find Windows Bun installation
WINDOWS_USER=$(cmd.exe /c "echo %USERNAME%" 2>/dev/null | tr -d '\r\n' || echo "")

if [ -n "$WINDOWS_USER" ]; then
    # Try common Windows Bun locations
    if [ -f "/mnt/c/Users/$WINDOWS_USER/.bun/bin/bun.exe" ]; then
        BUN_EXE="/mnt/c/Users/$WINDOWS_USER/.bun/bin/bun.exe"
    elif [ -f "/mnt/c/Program Files/Bun/bun.exe" ]; then
        BUN_EXE="/mnt/c/Program Files/Bun/bun.exe"
    fi
fi

# Create dist directory
mkdir -p dist

if [ -n "$BUN_EXE" ] && [ -f "$BUN_EXE" ]; then
    echo "✓ Using Windows Bun for native module compatibility"
    echo "  Path: $BUN_EXE"
    "$BUN_EXE" build ./index.ts --compile --outfile=dist/bud.exe
else
    echo "⚠️  Windows Bun not found, attempting cross-compile..."
    echo "  Note: This may fail if native modules (like OpenTUI) are used"
    bun build ./index.ts --compile --target=bun-windows-x64 --outfile=dist/bud.exe
fi

echo "✅ Build complete: dist/bud.exe"
