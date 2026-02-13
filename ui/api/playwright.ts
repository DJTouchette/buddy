import type { ApiContext } from "./context";
import { handler, errorResponse } from "./helpers";
import { join } from "path";
import { readdirSync } from "fs";
import * as os from "os";

const PLAYWRIGHT_DIR = join(os.homedir(), "work", "2cassadol", "playwright");

// ── Structured run state ────────────────────────────────────────────────

interface PwTestResult {
  index: number;
  project: string;
  file: string;
  title: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  duration: string;
  output: string[];
}

interface PwRunState {
  phase: "installing" | "running" | "done";
  tests: PwTestResult[];
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  startedAt: number;
  error: string | null;
}

const runStates = new Map<string, PwRunState>();

// ── ANSI stripping ──────────────────────────────────────────────────────

function stripAnsi(str: string): string {
  return str.replace(
    /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[PX^_][^\x1b]*\x1b\\|\x1b[@-Z\\-_]|\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g,
    "",
  );
}

// ── Output parsing ──────────────────────────────────────────────────────

// Playwright list reporter lines look like:
//   ✓  1 [auth] › tests/patients.auth.spec.ts:10:5 › test title (1.2s)
//   ✘  2 [auth] › tests/contacts.auth.spec.ts:15:5 › test title (3.1s)
//   -  3 [auth] › tests/contacts.auth.spec.ts:20:5 › skipped test
// Also lines like:
//   Running 10 tests using 4 workers

const RESULT_RE =
  /^\s*([✓✘×·\-])\s+(\d+)\s+\[([^\]]+)\]\s+›\s+(\S+)\s+›\s+(.+?)(?:\s+\(([^)]+)\))?\s*$/;

const RUNNING_RE = /Running\s+(\d+)\s+tests?\s+using\s+(\d+)\s+workers?/;

function parseResultLine(line: string): {
  icon: string;
  index: number;
  project: string;
  file: string;
  title: string;
  duration: string;
  status: "passed" | "failed" | "skipped";
} | null {
  const m = RESULT_RE.exec(line);
  if (!m) return null;

  const icon = m[1];
  let status: "passed" | "failed" | "skipped";
  if (icon === "✓") status = "passed";
  else if (icon === "✘" || icon === "×") status = "failed";
  else status = "skipped";

  return {
    icon,
    index: parseInt(m[2]),
    project: m[3],
    file: m[4],
    title: m[5].trim(),
    duration: m[6] || "",
    status,
  };
}

// ── Spawn + stream ──────────────────────────────────────────────────────

async function spawnAndStream(
  args: string[],
  cwd: string,
  jobId: string,
  ctx: ApiContext,
  onLine?: (line: string) => void,
): Promise<number> {
  const proc = Bun.spawn(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, FORCE_COLOR: "0", PW_TEST_REPORTER: "" },
  });

  ctx.jobService.registerProcess(jobId, proc);

  const streamOutput = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const rawLine of lines) {
        const line = stripAnsi(rawLine).replace(/\r/g, "").trim();
        if (line) {
          ctx.jobService.appendOutput(jobId, line);
          onLine?.(line);
        }
      }
    }
    if (buffer.trim()) {
      const line = stripAnsi(buffer).replace(/\r/g, "").trim();
      if (line) {
        ctx.jobService.appendOutput(jobId, line);
        onLine?.(line);
      }
    }
  };

  await Promise.all([
    streamOutput(proc.stdout),
    streamOutput(proc.stderr),
  ]);

  const exitCode = await proc.exited;
  ctx.jobService.unregisterProcess(jobId);
  return exitCode ?? 1;
}

// ── Test execution ──────────────────────────────────────────────────────

async function executePlaywrightRun(
  jobId: string,
  specs: string[] | null,
  project: string,
  ctx: ApiContext,
) {
  ctx.jobService.updateJobStatus(jobId, "running");

  const state: PwRunState = {
    phase: "running",
    tests: [],
    passed: 0,
    failed: 0,
    skipped: 0,
    total: 0,
    startedAt: Date.now(),
    error: null,
  };
  runStates.set(jobId, state);

  const args = [
    "npx", "playwright", "test",
    "--reporter=list",
  ];

  if (project && project !== "all") {
    args.push("--project", project);
  }

  if (specs && specs.length > 0) {
    args.push(...specs);
  }

  ctx.jobService.appendOutput(jobId, `=== Running Playwright tests ===`);
  if (specs && specs.length > 0) {
    ctx.jobService.appendOutput(jobId, `Specs: ${specs.join(", ")}`);
  }
  if (project && project !== "all") {
    ctx.jobService.appendOutput(jobId, `Project: ${project}`);
  }
  ctx.jobService.appendOutput(jobId, ``);

  let currentFailOutput: string[] = [];
  let currentFailTest: PwTestResult | null = null;

  const exitCode = await spawnAndStream(args, PLAYWRIGHT_DIR, jobId, ctx, (line) => {
    // Parse "Running N tests using M workers"
    const runningMatch = RUNNING_RE.exec(line);
    if (runningMatch) {
      state.total = parseInt(runningMatch[1]);
      return;
    }

    // Parse individual test result lines
    const parsed = parseResultLine(line);
    if (parsed) {
      // If we had a failing test accumulating output, finalize it
      if (currentFailTest) {
        currentFailTest.output = [...currentFailOutput];
        currentFailOutput = [];
        currentFailTest = null;
      }

      const testResult: PwTestResult = {
        index: parsed.index,
        project: parsed.project,
        file: parsed.file,
        title: parsed.title,
        status: parsed.status,
        duration: parsed.duration,
        output: [],
      };

      state.tests.push(testResult);
      if (parsed.status === "passed") state.passed++;
      else if (parsed.status === "failed") {
        state.failed++;
        currentFailTest = testResult;
      }
      else if (parsed.status === "skipped") state.skipped++;

      return;
    }

    // If we're after a failed test, accumulate error output
    if (currentFailTest && line && !RUNNING_RE.test(line)) {
      currentFailOutput.push(line);
    }
  });

  // Finalize any remaining failure output
  if (currentFailTest) {
    currentFailTest.output = [...currentFailOutput];
  }

  // Update total from actual results if the "Running N tests" line wasn't parsed
  if (state.total === 0) {
    state.total = state.passed + state.failed + state.skipped;
  }

  state.phase = "done";

  ctx.jobService.appendOutput(jobId, ``);
  ctx.jobService.appendOutput(
    jobId,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  );
  ctx.jobService.appendOutput(
    jobId,
    `${state.passed} passed, ${state.failed} failed, ${state.skipped} skipped (${state.total} total)`,
  );

  if (state.failed > 0 || exitCode !== 0) {
    state.error = `${state.failed} test(s) failed`;
    ctx.jobService.updateJobStatus(jobId, "failed", state.error);
  } else {
    ctx.jobService.updateJobStatus(jobId, "completed");
  }

  // Clean up after 5 minutes
  setTimeout(() => runStates.delete(jobId), 5 * 60 * 1000);
}

// ── Routes ──────────────────────────────────────────────────────────────

export function playwrightRoutes(ctx: ApiContext) {
  return {
    "/api/playwright/specs": {
      GET: handler(async () => {
        try {
          const testsDir = join(PLAYWRIGHT_DIR, "tests");
          const files = readdirSync(testsDir)
            .filter((f) => f.endsWith(".spec.ts"))
            .sort();

          const specs = files.map((f) => {
            const isAuth = f.includes(".auth.");
            const isNoAuth = f.includes(".noauth.");
            return {
              file: f,
              name: f.replace(/\.(auth|noauth)\.spec\.ts$/, ""),
              project: isAuth ? "auth" : isNoAuth ? "noauth" : "unknown",
            };
          });

          return Response.json({ specs });
        } catch (err) {
          return Response.json({ specs: [], error: String(err) });
        }
      }),
    },

    "/api/playwright/run/:id/status": {
      GET: handler(async (req: Request) => {
        const state = runStates.get((req as any).params.id);
        if (!state) {
          return errorResponse("No active test run found", 404);
        }
        return Response.json({ state });
      }),
    },

    "/api/playwright/run": {
      POST: handler(async (req: Request) => {
        const body = (await req.json()) as {
          specs?: string[];
          project?: string;
        };

        const target = body.specs && body.specs.length > 0
          ? `Playwright (${body.specs.length} specs)`
          : `Playwright (${body.project || "all"})`;

        const job = ctx.jobService.createJob({ type: "playwright", target });

        // Run asynchronously
        executePlaywrightRun(
          job.id,
          body.specs || null,
          body.project || "all",
          ctx,
        );

        return Response.json({ job });
      }),
    },
  };
}
