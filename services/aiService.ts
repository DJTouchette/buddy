import { spawn } from "child_process";
import * as path from "path";
import type { ConfigService } from "./configService";
import type { JiraService, JiraIssue } from "./jiraService";

export type AIFixMode = "file-only" | "interactive";

export interface AIFixOptions {
  ticketKey: string;
  repoPath: string;
  mode: AIFixMode;
  onOutput: (line: string) => void;
  onError: (line: string) => void;
  onComplete: (success: boolean, error?: string, sessionId?: string) => void;
  signal?: AbortSignal;
}

export interface TicketContext {
  ticket: JiraIssue;
  parentTicket?: JiraIssue;
}

export class AIService {
  constructor(
    private configService: ConfigService,
    private jiraService: JiraService
  ) {}

  /**
   * Check if Claude CLI is available
   */
  async isClaudeAvailable(): Promise<boolean> {
    const claudePath = await this.configService.getClaudePath();
    try {
      const proc = Bun.spawn([claudePath, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Get ticket context including parent ticket if available
   */
  async getTicketContext(ticketKey: string): Promise<TicketContext> {
    const ticket = await this.jiraService.getIssue(ticketKey);

    // Check for parent ticket (epic link or parent)
    let parentTicket: JiraIssue | undefined;
    const parentKey = ticket.fields.parent?.key;

    if (parentKey) {
      try {
        parentTicket = await this.jiraService.getIssue(parentKey);
      } catch {
        // Parent might not be accessible
      }
    }

    return { ticket, parentTicket };
  }

  /**
   * Build the prompt for Claude to fix a ticket
   */
  buildPrompt(context: TicketContext): string {
    const { ticket, parentTicket } = context;

    let prompt = `You are being asked to fix a JIRA ticket. Be diligent and thorough.

## IMPORTANT: Autonomous Mode
- Do NOT ask any questions - just proceed with your best judgment
- Do NOT wait for confirmation - make decisions and execute
- Do NOT ask for clarification - use context clues and make reasonable assumptions
- If something is ambiguous, choose the most sensible approach and proceed
- Work autonomously from start to finish

## Instructions
1. First, gather as much information as you can about this codebase
2. Understand the existing patterns and architecture
3. Read relevant files to understand the context
4. Then implement the fix carefully
5. Do NOT commit the changes - leave them for review
6. Make sure to follow any guidelines in CLAUDE.md if it exists

## Ticket Information

**Key:** ${ticket.key}
**Summary:** ${ticket.fields.summary}
**Type:** ${ticket.fields.issuetype.name}
**Status:** ${ticket.fields.status.name}
**Priority:** ${ticket.fields.priority?.name || "Not set"}
`;

    if (ticket.fields.description) {
      prompt += `
**Description:**
${ticket.fields.description}
`;
    }

    if (parentTicket) {
      prompt += `
## Parent Ticket (for context)

**Key:** ${parentTicket.key}
**Summary:** ${parentTicket.fields.summary}
`;
      if (parentTicket.fields.description) {
        prompt += `
**Description:**
${parentTicket.fields.description}
`;
      }
    }

    // Add acceptance criteria if present (common custom field)
    const acceptanceCriteria = (ticket.fields as any).customfield_10037;
    if (acceptanceCriteria) {
      prompt += `
## Acceptance Criteria
${acceptanceCriteria}
`;
    }

    prompt += `
## Your Task
Implement the fix for this ticket. Be thorough in your investigation before making changes.
Do not commit - leave changes staged or unstaged for review.
`;

    return prompt;
  }

  /**
   * Write ticket context to a markdown file
   */
  async writeTicketFile(repoPath: string, ticketKey: string, context: TicketContext): Promise<string> {
    const claudeDir = path.join(repoPath, "CLAUDE");

    // Ensure CLAUDE directory exists
    await Bun.$`mkdir -p ${claudeDir}`.quiet();

    const filePath = path.join(claudeDir, `${ticketKey}.md`);
    const content = this.buildPrompt(context);

    await Bun.write(filePath, content);

    return filePath;
  }

  /**
   * Execute Claude CLI to fix a ticket
   */
  async fixTicket(options: AIFixOptions): Promise<void> {
    const { ticketKey, repoPath, mode, onOutput, onError, onComplete, signal } = options;

    // Check if AI is enabled
    const isEnabled = await this.configService.isAIEnabled();
    if (!isEnabled) {
      onError("AI features are not enabled. Set ai.enabled: true in ~/.buddy.yaml");
      onComplete(false, "AI not enabled");
      return;
    }

    onOutput(`Fetching ticket ${ticketKey} details...`);

    // Get ticket context
    let context: TicketContext;
    try {
      context = await this.getTicketContext(ticketKey);
      onOutput(`Ticket: ${context.ticket.fields.summary}`);
      if (context.parentTicket) {
        onOutput(`Parent: ${context.parentTicket.key} - ${context.parentTicket.fields.summary}`);
      }
    } catch (err) {
      onError(`Failed to fetch ticket: ${err}`);
      onComplete(false, `Failed to fetch ticket: ${err}`);
      return;
    }

    // Write the ticket file regardless of mode
    let ticketFilePath: string;
    try {
      ticketFilePath = await this.writeTicketFile(repoPath, ticketKey, context);
      onOutput(`\n✓ Wrote ticket context to: CLAUDE/${ticketKey}.md`);
    } catch (err) {
      onError(`Failed to write ticket file: ${err}`);
      onComplete(false, `Failed to write ticket file: ${err}`);
      return;
    }

    // File-only mode: just write the file and done
    if (mode === "file-only") {
      onOutput("\n" + "─".repeat(50));
      onOutput("\n📝 Ticket file created. You can now run Claude manually:");
      onOutput(`\n   cd ${repoPath}`);
      onOutput(`   claude "Read CLAUDE/${ticketKey}.md and implement the fix"`);
      onOutput("\n" + "─".repeat(50));
      onComplete(true);
      return;
    }

    // Interactive mode: run Claude with --print and session ID
    const claudeAvailable = await this.isClaudeAvailable();
    if (!claudeAvailable) {
      onError("Claude CLI not found. Make sure 'claude' is in your PATH or set ai.claudePath in config.");
      onComplete(false, "Claude CLI not found");
      return;
    }

    const claudePath = await this.configService.getClaudePath();
    const sessionId = crypto.randomUUID();

    // Build prompt that references the file
    const prompt = `Read the ticket file at CLAUDE/${ticketKey}.md and begin implementing the fix. Start by analyzing the codebase and understanding what needs to be done.`;

    const claudeArgs = [
      "--print",
      "--session-id", sessionId,
      "--model", "opus",
      prompt,
    ];

    onOutput("\nStarting Claude Code (interactive mode)...");
    onOutput(`Session ID: ${sessionId}`);
    onOutput(`Working directory: ${repoPath}`);
    onOutput("─".repeat(50) + "\n");

    const proc = spawn(claudePath, claudeArgs, {
      cwd: repoPath,
      env: {
        ...process.env,
        TERM: "xterm-256color",
      },
    });

    // Handle abort signal
    if (signal) {
      signal.addEventListener("abort", () => {
        proc.kill("SIGTERM");
      });
    }

    // Buffer for incomplete lines
    let stdoutBuffer = "";
    let stderrBuffer = "";

    // Helper to strip ANSI codes
    const stripAnsi = (str: string) => str
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
      .replace(/\x1b\][^\x07]*\x07/g, "")
      .replace(/\x1b\[\?[0-9;]*[a-zA-Z]/g, "")
      .replace(/\r/g, "");

    // Process buffered output
    const processBuffer = (buffer: string, handler: (line: string) => void): string => {
      const lines = buffer.split("\n");
      // Process all complete lines (all but the last)
      for (let i = 0; i < lines.length - 1; i++) {
        const cleanLine = stripAnsi(lines[i]);
        if (cleanLine.trim()) {
          handler(cleanLine);
        }
      }
      // Return the incomplete last line
      return lines[lines.length - 1];
    };

    // Stream stdout with buffering
    proc.stdout?.on("data", (data: Buffer) => {
      stdoutBuffer += data.toString();
      stdoutBuffer = processBuffer(stdoutBuffer, onOutput);
    });

    // Stream stderr with buffering
    proc.stderr?.on("data", (data: Buffer) => {
      stderrBuffer += data.toString();
      stderrBuffer = processBuffer(stderrBuffer, onError);
    });

    // Handle completion
    proc.on("close", (code) => {
      // Flush remaining buffers
      if (stdoutBuffer.trim()) {
        const cleanLine = stripAnsi(stdoutBuffer);
        if (cleanLine.trim()) onOutput(cleanLine);
      }
      if (stderrBuffer.trim()) {
        const cleanLine = stripAnsi(stderrBuffer);
        if (cleanLine.trim()) onError(cleanLine);
      }

      onOutput("\n" + "─".repeat(50));

      if (code === 0 || signal?.aborted) {
        onOutput("\n🎯 Claude session ready! To continue interactively, run:");
        onOutput(`\n   cd ${repoPath}`);
        onOutput(`   claude --resume ${sessionId}`);
        onOutput("\n" + "─".repeat(50));
        onComplete(true, undefined, sessionId);
      } else {
        onError(`\nClaude Code exited with code ${code}`);
        onComplete(false, `Exit code ${code}`, sessionId);
      }
    });

    proc.on("error", (err) => {
      onError(`Failed to spawn Claude: ${err.message}`);
      onComplete(false, err.message);
    });
  }
}
