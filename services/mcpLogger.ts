import { join } from "path";
import { homedir } from "os";
import { appendFileSync, writeFileSync } from "fs";

class McpLogger {
  private logFile: string;
  private enabled: boolean = true;

  constructor() {
    // Log to user's home directory
    this.logFile = join(homedir(), "buddy-mcp.log");

    // Clear old log file on startup
    try {
      writeFileSync(this.logFile, "");
    } catch {
      // Ignore if file doesn't exist
    }

    this.log("=".repeat(80));
    this.log(`MCP Server started at ${new Date().toISOString()}`);
    this.log(`Log file: ${this.logFile}`);
    this.log("=".repeat(80));
  }

  log(message: string) {
    if (!this.enabled) return;

    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] ${message}\n`;

    // Synchronously append to file (prevents corruption)
    try {
      appendFileSync(this.logFile, logLine);
    } catch {
      // Ignore file write errors
    }

    // Also write to stderr for console visibility
    console.error(message);
  }

  error(message: string, error?: any) {
    this.log(`❌ ERROR: ${message}`);
    if (error) {
      this.log(`   ${error instanceof Error ? error.stack : String(error)}`);
    }
  }

  getLogPath() {
    return this.logFile;
  }

  clearLog() {
    try {
      Bun.write(this.logFile, "");
    } catch {
      // Ignore errors
    }
  }
}

// Singleton instance
export const mcpLogger = new McpLogger();
