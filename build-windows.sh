#!/bin/bash
# Build for Windows using Windows Bun from WSL

# Try to find Windows Bun
if [ -f "/mnt/c/Users/$USER/.bun/bin/bun.exe" ]; then
    BUN_EXE="/mnt/c/Users/$USER/.bun/bin/bun.exe"
elif [ -f "/mnt/c/Program Files/Bun/bun.exe" ]; then
    BUN_EXE="/mnt/c/Program Files/Bun/bun.exe"
else
    echo "Error: Could not find Windows Bun installation"
    echo "Please install Bun on Windows or specify the path manually"
    exit 1
fi

echo "Using: $BUN_EXE"
"$BUN_EXE" build test-opentui.ts --compile --outfile=test-opentui-win.exe
