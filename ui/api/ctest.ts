import type { JobService } from "../../services/jobService";
import type { CacheService } from "../../services/cacheService";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import * as os from "os";

const REPO_ROOT = join(os.homedir(), "work", "2cassadol");
const BACKEND_DIR = join(REPO_ROOT, "backend");
const SLN_FILE = join(BACKEND_DIR, "backend.sln");
const CACHE_DIR = join(os.homedir(), ".cache", "ctest");
const DOTNET_WARNS = "--nowarn:NU1803,CS0162,CS0168,CS0219";

export interface CTestApiContext {
  jobService: JobService;
  cacheService: CacheService;
}

interface TestProject {
  name: string;
  csprojPath: string;
}

// ── Structured test run state ───────────────────────────────────────────

interface TestResult {
  fqn: string;
  shortName: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  duration: string;
  output: string[];
}

interface TestRunState {
  phase: "building" | "running" | "done";
  tests: TestResult[];
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  startedAt: number;
  error: string | null;
}

// In-memory state for active test runs, keyed by jobId
const testRunStates = new Map<string, TestRunState>();

export function getTestRunState(jobId: string): TestRunState | undefined {
  return testRunStates.get(jobId);
}

// ── SLN parsing ──────────────────────────────────────────────────────────

function parseTestProjects(): TestProject[] {
  if (!existsSync(SLN_FILE)) return [];
  const content = readFileSync(SLN_FILE, "utf-8");
  const re = /"([^"]+\.Tests)"[^"]*"([^"]+\.csproj)"/g;
  const projects: TestProject[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    projects.push({
      name: match[1],
      csprojPath: join(BACKEND_DIR, match[2].replace(/\\/g, "/")),
    });
  }
  return projects;
}

// ── Cache helpers ────────────────────────────────────────────────────────

function ensureCacheDir() {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function getCachePathFor(name: string): string {
  return join(CACHE_DIR, `${name}.txt`);
}

function isCacheValid(name: string, csprojPath: string): boolean {
  const cachePath = getCachePathFor(name);
  if (!existsSync(cachePath)) return false;
  try {
    return statSync(cachePath).mtimeMs > statSync(csprojPath).mtimeMs;
  } catch {
    return false;
  }
}

function getCachedTests(name: string): string[] {
  const cachePath = getCachePathFor(name);
  if (!existsSync(cachePath)) return [];
  try {
    const content = readFileSync(cachePath, "utf-8").trim();
    return content ? content.split("\n") : [];
  } catch {
    return [];
  }
}

function shortName(fqn: string): string {
  // Strip parameters for display: "Class.Method(param: value)" -> "Class.Method"
  const base = fqn.replace(/\(.*$/, "");
  const parts = base.split(".");
  if (parts.length >= 2) return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  return fqn;
}

// Noise prefixes from dotnet test debug/info output that leak through script -qec
const NOISE_PREFIXES = [
  "Debug:", "Informational:", "Parameters:", "SELECT ", "FROM ", "WHERE ",
  "LIMIT ", "INSERT ", "UPDATE ", "DELETE ", "=", "[xUnit", "[browser",
  "Build succeeded", "Warning(s)", "Error(s)", "Time Elapsed",
  "Workload updates", "dotnet workload",
];

function isTestName(line: string): boolean {
  // A test FQN has dots and starts with a letter/namespace
  if (!line.includes(".")) return false;
  for (const prefix of NOISE_PREFIXES) {
    if (line.startsWith(prefix)) return false;
  }
  // Must look like a dotted identifier, optionally with parameters
  return /^[A-Za-z][\w.]+(\(.*\))?$/.test(line);
}

// ── ANSI stripping ───────────────────────────────────────────────────────

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[PX^_][^\x1b]*\x1b\\|\x1b[@-Z\\-_]|\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g, "");
}

// ── Shell quoting ────────────────────────────────────────────────────────

function shellQuote(s: string): string {
  if (/^[a-zA-Z0-9._\-\/=:]+$/.test(s)) return s;
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ── Test result parsing ──────────────────────────────────────────────────

const RESULT_RE = /^[^A-Za-z]*(Passed|Failed|Skipped)\s+(.+?)(?:\s+\[(.+?)\])?\s*$/;

function parseResultLine(line: string): {
  result: "Passed" | "Failed" | "Skipped";
  testMethod: string;
  duration: string;
} | null {
  const m = RESULT_RE.exec(line);
  if (!m) return null;
  return {
    result: m[1] as "Passed" | "Failed" | "Skipped",
    testMethod: m[2].trim(),
    duration: m[3] ? `[${m[3]}]` : "",
  };
}

// ── Spawn + stream lines ─────────────────────────────────────────────────

async function spawnAndStream(
  args: string[],
  jobId: string,
  ctx: CTestApiContext,
  onLine?: (line: string) => void,
): Promise<number> {
  const cmdStr = args.map(shellQuote).join(" ");
  const proc = Bun.spawn(["script", "-qec", cmdStr, "/dev/null"], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, MSBUILDTERMINALLOGGER: "off" },
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
        const line = stripAnsi(rawLine).replace(/\r/g, "").replace(/^=\s*/, "").trim();
        if (line) {
          onLine?.(line);
        }
      }
    }
    if (buffer.trim()) {
      const line = stripAnsi(buffer).replace(/\r/g, "").replace(/^=\s*/, "").trim();
      if (line) onLine?.(line);
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

// ── Build helper ─────────────────────────────────────────────────────────

async function buildProject(
  csprojPath: string,
  jobId: string,
  ctx: CTestApiContext,
): Promise<boolean> {
  const name = csprojPath.split("/").pop()!;
  ctx.jobService.appendOutput(jobId, `Restoring ${name}...`);

  // Restore separately with --disable-parallel to avoid NuGet concurrent collection race
  const restoreRc = await spawnAndStream(
    ["dotnet", "restore", csprojPath, DOTNET_WARNS, "--disable-parallel"],
    jobId,
    ctx,
  );
  if (restoreRc !== 0) {
    ctx.jobService.appendOutput(jobId, `Restore failed (exit ${restoreRc}), attempting build anyway...`);
  }

  ctx.jobService.appendOutput(jobId, `Building ${name}...`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const lastLines: string[] = [];
    const rc = await spawnAndStream(
      ["dotnet", "build", csprojPath, "--no-restore", DOTNET_WARNS, "--nologo", "-v", "q"],
      jobId,
      ctx,
      (line) => {
        lastLines.push(line);
      },
    );
    if (rc === 0) {
      ctx.jobService.appendOutput(jobId, `Build complete.`);
      return true;
    }
    if (attempt < 3) {
      ctx.jobService.appendOutput(jobId, `Build attempt ${attempt} failed, retrying...`);
    } else {
      ctx.jobService.appendOutput(jobId, `Build failed after 3 attempts:`);
      for (const line of lastLines.slice(-15)) {
        ctx.jobService.appendOutput(jobId, line);
      }
    }
  }
  return false;
}

// ── Test execution ───────────────────────────────────────────────────────

async function executeTestRun(
  jobId: string,
  projectName: string,
  csprojPath: string,
  testNames: string[] | null,
  integration: boolean,
  ctx: CTestApiContext,
) {
  ctx.jobService.updateJobStatus(jobId, "running");
  const catFilter = integration ? "" : "Category!=Integration";
  const isIndividual = testNames && testNames.length > 0;

  // Initialize structured state
  const state: TestRunState = {
    phase: "building",
    tests: [],
    passed: 0,
    failed: 0,
    skipped: 0,
    total: isIndividual ? testNames.length : 0,
    startedAt: Date.now(),
    error: null,
  };

  if (isIndividual) {
    state.tests = testNames.map((fqn) => ({
      fqn,
      shortName: shortName(fqn),
      status: "pending" as const,
      duration: "",
      output: [],
    }));
  }

  testRunStates.set(jobId, state);

  ctx.jobService.appendOutput(jobId, `=== Running tests: ${projectName} ===`);
  if (isIndividual) {
    ctx.jobService.appendOutput(jobId, `Tests: ${testNames.length} selected`);
  }
  ctx.jobService.appendOutput(jobId, ``);

  // Build
  const buildOk = await buildProject(csprojPath, jobId, ctx);
  if (!buildOk) {
    state.phase = "done";
    state.error = "Build failed";
    ctx.jobService.updateJobStatus(jobId, "failed", "Build failed");
    return;
  }

  state.phase = "running";
  ctx.jobService.appendOutput(jobId, ``);

  if (isIndividual) {
    // Run individual tests in parallel using separate processes
    const maxJobs = Math.max(1, Math.floor(os.cpus().length / 2));
    const jobs = Math.min(maxJobs, testNames.length);
    ctx.jobService.appendOutput(jobId, `Running ${testNames.length} test(s) (${jobs} parallel)...`);
    ctx.jobService.appendOutput(jobId, ``);

    let nextIdx = 0;

    const workers: Promise<void>[] = [];
    for (let w = 0; w < jobs; w++) {
      workers.push(
        (async () => {
          while (true) {
            const idx = nextIdx++;
            if (idx >= testNames.length) break;

            const fqn = testNames[idx];
            const sn = shortName(fqn);
            const testEntry = state.tests[idx];
            testEntry.status = "running";

            const filterParts = [`FullyQualifiedName~${fqn}`];
            if (catFilter) filterParts.push(catFilter);

            const args = [
              "dotnet", "test", csprojPath,
              "--no-build", "--filter", filterParts.join("&"),
              DOTNET_WARNS, "-v", "n",
            ];

            await spawnAndStream(args, jobId, ctx, (line) => {
              testEntry.output.push(line);
              const parsed = parseResultLine(line);
              if (parsed) {
                const status = parsed.result.toLowerCase() as "passed" | "failed" | "skipped";
                testEntry.status = status;
                testEntry.duration = parsed.duration;
                if (status === "passed") state.passed++;
                else if (status === "failed") state.failed++;
                else if (status === "skipped") state.skipped++;
                const icon = status === "passed" ? "✓" : status === "failed" ? "✗" : "⊘";
                ctx.jobService.appendOutput(jobId, `  ${icon} ${sn} ${testEntry.duration}`);
              } else if (/Passed|Failed|Skipped/i.test(line)) {
                // DEBUG: log lines that look like results but didn't match
                const codes = Array.from(line.slice(0, 40)).map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
                ctx.jobService.appendOutput(jobId, `  [DEBUG] no-match: "${line.slice(0, 80)}" codes=[${codes}]`);
              }
            });

            if (testEntry.status === "running") {
              testEntry.status = "failed";
              state.failed++;
            }
          }
        })(),
      );
    }

    await Promise.all(workers);

    ctx.jobService.appendOutput(jobId, ``);
    ctx.jobService.appendOutput(jobId, `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    ctx.jobService.appendOutput(jobId, `${state.passed} passed, ${state.failed} failed, ${state.skipped} skipped (${testNames.length} total)`);

    // Show failure details
    const failedTests = state.tests.filter((t) => t.status === "failed");
    if (failedTests.length > 0) {
      ctx.jobService.appendOutput(jobId, ``);
      for (const t of failedTests) {
        ctx.jobService.appendOutput(jobId, `--- FAILED: ${t.shortName} ---`);
        for (const line of t.output) {
          ctx.jobService.appendOutput(jobId, line);
        }
      }
    }

    state.phase = "done";
    ctx.jobService.updateJobStatus(jobId, state.failed > 0 ? "failed" : "completed",
      state.failed > 0 ? `${state.failed} test(s) failed` : undefined);

  } else {
    // Run whole project
    ctx.jobService.appendOutput(jobId, `Running all tests...`);
    ctx.jobService.appendOutput(jobId, ``);

    const filterArgs: string[] = [];
    if (catFilter) filterArgs.push("--filter", catFilter);

    const args = [
      "dotnet", "test", csprojPath,
      "--no-build", ...filterArgs, DOTNET_WARNS, "-v", "n",
    ];

    const allOutput: string[] = [];
    await spawnAndStream(args, jobId, ctx, (line) => {
      allOutput.push(line);
      const parsed = parseResultLine(line);
      if (parsed) {
        const status = parsed.result.toLowerCase() as "passed" | "failed" | "skipped";
        if (status === "passed") state.passed++;
        else if (status === "failed") state.failed++;
        else if (status === "skipped") state.skipped++;
        state.total = state.passed + state.failed + state.skipped;

        // Add to structured tests list
        state.tests.push({
          fqn: parsed.testMethod,
          shortName: shortName(parsed.testMethod),
          status,
          duration: parsed.duration,
          output: [],
        });

        ctx.jobService.appendOutput(jobId, `  ${parsed.result} ${parsed.testMethod} ${parsed.duration}`);
      } else if (/Passed|Failed|Skipped/i.test(line)) {
        // DEBUG: log lines that look like results but didn't match
        const codes = Array.from(line.slice(0, 40)).map(c => c.charCodeAt(0).toString(16).padStart(2, "0")).join(" ");
        ctx.jobService.appendOutput(jobId, `  [DEBUG] no-match: "${line.slice(0, 80)}" codes=[${codes}]`);
      }
    });

    // Also parse the summary line for accurate counts
    const summaryRe = /Failed:\s*(\d+).*?Passed:\s*(\d+).*?Skipped:\s*(\d+).*?Total:\s*(\d+)/;
    for (const line of allOutput) {
      const m = summaryRe.exec(line);
      if (m) {
        state.failed = parseInt(m[1]);
        state.passed = parseInt(m[2]);
        state.skipped = parseInt(m[3]);
        state.total = parseInt(m[4]);
      }
    }

    ctx.jobService.appendOutput(jobId, ``);
    ctx.jobService.appendOutput(jobId, `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    ctx.jobService.appendOutput(jobId, `${state.passed} passed, ${state.failed} failed, ${state.skipped} skipped (${state.total} total)`);

    // Show failure output
    if (state.failed > 0) {
      ctx.jobService.appendOutput(jobId, ``);
      for (const line of allOutput) {
        if (line.includes("Failed") || line.includes("Error") || line.includes("Assert")) {
          ctx.jobService.appendOutput(jobId, line);
        }
      }
    }

    state.phase = "done";
    ctx.jobService.updateJobStatus(jobId, state.failed > 0 ? "failed" : "completed",
      state.failed > 0 ? `${state.failed} test(s) failed` : undefined);
  }

  // Clean up state after 5 minutes
  setTimeout(() => testRunStates.delete(jobId), 5 * 60 * 1000);
}

// ── Discover tests (with cache) ──────────────────────────────────────────

async function discoverTestsForProject(
  projectName: string,
  csprojPath: string,
  forceRebuild: boolean,
): Promise<string[]> {
  ensureCacheDir();

  if (!forceRebuild && isCacheValid(projectName, csprojPath)) {
    return getCachedTests(projectName);
  }

  const lines: string[] = [];
  let inList = false;

  for (let attempt = 1; attempt <= 2; attempt++) {
    lines.length = 0;
    inList = false;

    const cmdStr = ["dotnet", "test", csprojPath, "--list-tests", DOTNET_WARNS].map(shellQuote).join(" ");
    const proc = Bun.spawn(["script", "-qec", cmdStr, "/dev/null"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, MSBUILDTERMINALLOGGER: "off" },
    });

    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop()!;
      for (const rawLine of parts) {
        const line = stripAnsi(rawLine).replace(/\r/g, "").trim();
        if (line.includes("The following Tests are available:")) {
          inList = true;
          continue;
        }
        if (inList) {
          if (!line) { inList = false; continue; }
          // Filter out debug spew that leaks through script -qec
          if (isTestName(line)) {
            lines.push(line);
          }
        }
      }
    }

    await proc.exited;

    if (lines.length > 0) {
      writeFileSync(getCachePathFor(projectName), lines.join("\n") + "\n");
      return lines;
    }
  }

  return [];
}

// ── Routes ───────────────────────────────────────────────────────────────

export function ctestRoutes(ctx: CTestApiContext) {
  return {
    // GET /api/ctest/projects — list all test projects
    "/api/ctest/projects": {
      GET: async () => {
        try {
          const projects = parseTestProjects();
          const result = projects.map((p) => ({
            name: p.name,
            csprojPath: p.csprojPath,
            cachedTestCount: getCachedTests(p.name).length,
          }));
          return Response.json({ projects: result });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/ctest/tests/:project — discover tests for a project
    "/api/ctest/tests/:project": {
      GET: async (req: Request & { params: { project: string } }) => {
        try {
          const projectName = decodeURIComponent(req.params.project);
          const url = new URL(req.url);
          const rebuild = url.searchParams.get("rebuild") === "true";

          const projects = parseTestProjects();
          const project = projects.find((p) => p.name === projectName);
          if (!project) {
            return Response.json({ error: `Project not found: ${projectName}` }, { status: 404 });
          }

          const tests = await discoverTestsForProject(project.name, project.csprojPath, rebuild);
          return Response.json({
            project: project.name,
            tests: tests.map((fqn) => ({ fqn, shortName: shortName(fqn) })),
          });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/ctest/run/:id/status — get structured test run status
    "/api/ctest/run/:id/status": {
      GET: async (req: Request & { params: { id: string } }) => {
        const state = testRunStates.get(req.params.id);
        if (!state) {
          return Response.json({ error: "No active test run found" }, { status: 404 });
        }
        return Response.json({ state });
      },
    },

    // POST /api/ctest/run — run tests (creates a job)
    "/api/ctest/run": {
      POST: async (req: Request) => {
        try {
          const body = (await req.json()) as {
            project: string;
            tests?: string[];
            integration?: boolean;
          };

          if (!body.project) {
            return Response.json({ error: "Missing project name" }, { status: 400 });
          }

          const projects = parseTestProjects();
          const project = projects.find((p) => p.name === body.project);
          if (!project) {
            return Response.json({ error: `Project not found: ${body.project}` }, { status: 404 });
          }

          const target = body.tests && body.tests.length > 0
            ? `${project.name} (${body.tests.length} tests)`
            : project.name;

          const job = ctx.jobService.createJob({ type: "ctest", target });

          // Run asynchronously
          executeTestRun(
            job.id,
            project.name,
            project.csprojPath,
            body.tests || null,
            body.integration || false,
            ctx,
          );

          return Response.json({ job });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },
  };
}
