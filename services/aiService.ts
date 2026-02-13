import { spawn } from "child_process";
import * as path from "path";
import type { ConfigService } from "./configService";
import type { JiraService, JiraIssue } from "./jiraService";
import { adfToMarkdown } from "../shared/adfToMarkdown";
import { query as claudeQuery } from "@anthropic-ai/claude-agent-sdk";

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

// --- Start with AI types ---

export type AIStreamEvent =
  | { type: "status"; message: string }
  | { type: "session_id"; sessionId: string }
  | { type: "assistant_text"; text: string }
  | { type: "tool_use"; toolName: string; toolInput: string }
  | { type: "result"; sessionId: string; costUsd: number; durationMs: number; numTurns: number }
  | { type: "error"; message: string }
  | { type: "file_created"; filePath: string };

export interface StartWithAIOptions {
  ticketKey: string;
  repoPath: string;
  onEvent: (event: AIStreamEvent) => void;
  onComplete: (sessionId: string) => void;
  signal?: AbortSignal;
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
   * Build the start.md content for Start with AI
   */
  buildStartMd(context: TicketContext): string {
    const { ticket, parentTicket } = context;

    let md = `# ${ticket.key}: ${ticket.fields.summary}\n\n`;

    // Metadata
    md += `| Field | Value |\n|-------|-------|\n`;
    md += `| Type | ${ticket.fields.issuetype.name} |\n`;
    md += `| Status | ${ticket.fields.status.name} |\n`;
    md += `| Priority | ${ticket.fields.priority?.name || "Not set"} |\n`;
    if (parentTicket) {
      md += `| Parent | ${parentTicket.key}: ${parentTicket.fields.summary} |\n`;
    }
    md += "\n";

    // Description
    if (ticket.fields.description) {
      md += `## Description\n\n`;
      const description = adfToMarkdown(ticket.fields.description);
      md += description + "\n\n";
    }

    // Parent description for context
    if (parentTicket?.fields.description) {
      md += `## Parent Context (${parentTicket.key})\n\n`;
      const parentDesc = adfToMarkdown(parentTicket.fields.description);
      md += parentDesc + "\n\n";
    }

    // Acceptance criteria
    const acceptanceCriteria = (ticket.fields as any).customfield_10037;
    if (acceptanceCriteria) {
      md += `## Acceptance Criteria\n\n`;
      md += typeof acceptanceCriteria === "string"
        ? acceptanceCriteria
        : adfToMarkdown(acceptanceCriteria);
      md += "\n\n";
    }

    // Subtasks
    if (ticket.fields.subtasks && ticket.fields.subtasks.length > 0) {
      md += `## Subtasks\n\n`;
      for (const subtask of ticket.fields.subtasks) {
        const done = subtask.fields.status.name.toLowerCase() === "done";
        md += `- [${done ? "x" : " "}] ${subtask.key}: ${subtask.fields.summary} (${subtask.fields.status.name})\n`;
      }
      md += "\n";
    }

    // Clues section
    md += `## Clues\n\n`;
    md += `_Add any hints, relevant file paths, or context that might help._\n`;

    return md;
  }

  /**
   * Start with AI using the Claude Agent SDK
   */
  async startWithAI(options: StartWithAIOptions): Promise<void> {
    const { ticketKey, repoPath, onEvent, onComplete, signal } = options;

    // Check if AI is enabled
    const isEnabled = await this.configService.isAIEnabled();
    if (!isEnabled) {
      onEvent({ type: "error", message: "AI features are not enabled. Set ai.enabled: true in ~/.buddy.yaml" });
      return;
    }

    onEvent({ type: "status", message: `Fetching ticket ${ticketKey} details...` });

    // Get ticket context
    let context: TicketContext;
    try {
      context = await this.getTicketContext(ticketKey);
      onEvent({ type: "status", message: `Ticket: ${context.ticket.fields.summary}` });
    } catch (err) {
      onEvent({ type: "error", message: `Failed to fetch ticket: ${err}` });
      return;
    }

    // Create ticket directory
    const ticketDir = path.join(repoPath, ".claude", "tickets", ticketKey);
    try {
      await Bun.$`mkdir -p ${ticketDir}`.quiet();
    } catch (err) {
      onEvent({ type: "error", message: `Failed to create ticket directory: ${err}` });
      return;
    }

    // Write start.md
    const startMdPath = path.join(ticketDir, "start.md");
    try {
      const startMdContent = this.buildStartMd(context);
      await Bun.write(startMdPath, startMdContent);
      onEvent({ type: "file_created", filePath: `.claude/tickets/${ticketKey}/start.md` });
      onEvent({ type: "status", message: `Created .claude/tickets/${ticketKey}/start.md` });
    } catch (err) {
      onEvent({ type: "error", message: `Failed to write start.md: ${err}` });
      return;
    }

    // Ensure the start-ticket command exists in the target repo
    const commandDir = path.join(repoPath, ".claude", "commands");
    const commandPath = path.join(commandDir, "start-ticket.md");
    try {
      const exists = await Bun.file(commandPath).exists();
      if (!exists) {
        await Bun.$`mkdir -p ${commandDir}`.quiet();
        // Copy our command file to the target repo
        const sourceCommand = path.join(import.meta.dir, "..", ".claude", "commands", "start-ticket.md");
        const sourceExists = await Bun.file(sourceCommand).exists();
        if (sourceExists) {
          const content = await Bun.file(sourceCommand).text();
          await Bun.write(commandPath, content);
        } else {
          // Fallback: write inline
          await Bun.write(commandPath, `Read the ticket start file at \`.claude/tickets/$ARGUMENTS/start.md\` to understand the ticket requirements.

Then follow this workflow:

1. **Explore the codebase** — Understand the architecture, patterns, and relevant code areas
2. **Create a plan** — Write your implementation plan to \`.claude/tickets/$ARGUMENTS/plan.md\`
3. **Begin implementation** — Start implementing the plan
4. **Track progress** — Update \`.claude/tickets/$ARGUMENTS/trace.md\` as you work

Important:
- Do NOT commit changes — leave them for review
- Follow any guidelines in CLAUDE.md if it exists
- Be thorough in your investigation before making changes
- Work autonomously — do not ask questions, make reasonable decisions
`);
        }
        onEvent({ type: "file_created", filePath: `.claude/commands/start-ticket.md` });
      }
    } catch {
      // Non-fatal: the command file is a convenience
    }

    onEvent({ type: "status", message: "Starting Claude Agent SDK..." });

    // Create abort controller
    const abortController = new AbortController();
    if (signal) {
      signal.addEventListener("abort", () => abortController.abort());
    }

    try {
      // Strip CLAUDECODE env var to avoid "nested session" rejection
      const cleanEnv = { ...process.env };
      delete cleanEnv.CLAUDECODE;

      const q = claudeQuery({
        prompt: `/start-ticket ${ticketKey}`,
        options: {
          cwd: repoPath,
          permissionMode: "acceptEdits",
          model: "claude-opus-4-6",
          includePartialMessages: true,
          settingSources: ["project"],
          systemPrompt: { type: "preset", preset: "claude_code" },
          tools: { type: "preset", preset: "claude_code" },
          abortController,
          env: cleanEnv,
        },
      });

      let sessionId = "";

      for await (const message of q) {
        if (signal?.aborted) break;

        switch (message.type) {
          case "system": {
            if (message.subtype === "init") {
              sessionId = message.session_id;
              onEvent({ type: "session_id", sessionId });
              onEvent({ type: "status", message: `Session started (model: ${(message as any).model})` });
            }
            break;
          }

          case "stream_event": {
            const event = (message as any).event;
            if (!event) break;

            switch (event.type) {
              case "content_block_start": {
                const block = event.content_block;
                if (block?.type === "tool_use") {
                  onEvent({ type: "tool_use", toolName: block.name, toolInput: "" });
                }
                break;
              }
              case "content_block_delta": {
                const delta = event.delta;
                if (delta?.type === "text_delta" && delta.text) {
                  onEvent({ type: "assistant_text", text: delta.text });
                }
                break;
              }
            }
            break;
          }

          case "assistant": {
            if (message.message?.content) {
              for (const block of message.message.content) {
                if (block.type === "tool_use") {
                  const inputStr = typeof block.input === "string"
                    ? block.input
                    : JSON.stringify(block.input, null, 2);
                  onEvent({
                    type: "tool_use",
                    toolName: block.name,
                    toolInput: inputStr.length > 500 ? inputStr.slice(0, 500) + "..." : inputStr,
                  });
                }
              }
            }
            break;
          }

          case "tool_use_summary": {
            onEvent({ type: "status", message: (message as any).summary });
            break;
          }

          case "result": {
            onEvent({
              type: "result",
              sessionId: (message as any).session_id,
              costUsd: (message as any).total_cost_usd,
              durationMs: (message as any).duration_ms,
              numTurns: (message as any).num_turns,
            });

            if ((message as any).is_error) {
              const errors = "errors" in message ? (message as any).errors : [];
              onEvent({
                type: "error",
                message: `Session ended with error: ${errors.join(", ") || "unknown"}`,
              });
            }
            break;
          }
        }
      }

      onComplete(sessionId);
    } catch (err: any) {
      if (err?.name === "AbortError" || signal?.aborted) {
        onEvent({ type: "status", message: "Session cancelled" });
        return;
      }
      onEvent({ type: "error", message: `Claude SDK error: ${err?.message || err}` });
    }
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
