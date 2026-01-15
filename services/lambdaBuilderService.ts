import { $ } from "bun";
import * as path from "path";
import * as os from "os";
import type { JobService } from "./jobService";
import type { LambdaInfo } from "./infraService";

export interface BuildResult {
  name: string;
  success: boolean;
  error?: string;
  duration: number;
}

export interface BuildProgress {
  total: number;
  completed: number;
  current: string | null;
  results: BuildResult[];
}

export class LambdaBuilderService {
  private jobService: JobService;

  constructor(jobService: JobService) {
    this.jobService = jobService;
  }

  /**
   * Build a single lambda
   */
  async buildLambda(
    lambda: LambdaInfo,
    jobId: string,
    onOutput?: (line: string) => void
  ): Promise<BuildResult> {
    const startTime = Date.now();
    const output = onOutput || ((line: string) => this.jobService.appendOutput(jobId, line));

    output(`\n=== Building ${lambda.name} (${lambda.type}) ===`);
    output(`Path: ${lambda.path}`);

    try {
      switch (lambda.type) {
        case "dotnet":
          await this.buildDotnetLambda(lambda, output);
          break;
        case "js":
          await this.buildJsLambda(lambda, output);
          break;
        case "python":
          await this.buildPythonLambda(lambda, output);
          break;
        case "typescript-edge":
          await this.buildTypescriptEdgeLambda(lambda, output);
          break;
      }

      const duration = Date.now() - startTime;
      output(`✓ ${lambda.name} completed in ${(duration / 1000).toFixed(1)}s`);

      // Update build tracking
      this.jobService.updateLambdaBuild(lambda.name, lambda.type, "success", true);

      return { name: lambda.name, success: true, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);
      output(`✗ ${lambda.name} failed: ${errorMsg}`);

      // Update build tracking
      this.jobService.updateLambdaBuild(lambda.name, lambda.type, "failed", false);

      return { name: lambda.name, success: false, error: errorMsg, duration };
    }
  }

  /**
   * Get system resource info
   */
  private getSystemResources(): {
    freeMemoryGB: number;
    totalMemoryGB: number;
    memoryUsagePercent: number;
    loadAvg1m: number;
    cpuCount: number;
    loadPerCpu: number;
  } {
    const freeMemoryGB = os.freemem() / (1024 * 1024 * 1024);
    const totalMemoryGB = os.totalmem() / (1024 * 1024 * 1024);
    const memoryUsagePercent = ((totalMemoryGB - freeMemoryGB) / totalMemoryGB) * 100;
    const loadAvg1m = os.loadavg()[0];
    const cpuCount = os.cpus().length;
    const loadPerCpu = loadAvg1m / cpuCount;

    return { freeMemoryGB, totalMemoryGB, memoryUsagePercent, loadAvg1m, cpuCount, loadPerCpu };
  }

  /**
   * Get parallelism based on lambda type and current system resources
   * Aggressive settings - assumes storage is no longer the bottleneck
   */
  private getParallelismForType(type: LambdaInfo["type"], jobId?: string): number {
    const res = this.getSystemResources();

    // Aggressive base parallelism by type
    let base: number;
    switch (type) {
      case "dotnet":
        base = 4; // Increased from 2 - .NET builds are CPU heavy but we have capacity
        break;
      case "typescript-edge":
        base = 4; // Increased from 2
        break;
      case "js":
      case "python":
        base = 8; // Increased from 3 - these are lightweight
        break;
      default:
        base = 2;
    }

    // Only reduce parallelism if system is under heavy stress
    let adjusted = base;

    // If memory usage > 90%, reduce parallelism significantly
    if (res.memoryUsagePercent > 90) {
      adjusted = Math.max(1, Math.floor(base / 4));
      if (jobId) {
        this.jobService.appendOutput(jobId, `   ⚠️ Very high memory usage (${res.memoryUsagePercent.toFixed(0)}%), limiting to ${adjusted} parallel build(s)`);
      }
    }
    // If memory usage > 80%, cap at half
    else if (res.memoryUsagePercent > 80) {
      adjusted = Math.max(2, Math.floor(base / 2));
    }

    // If CPU load is very high (> 1.5 per core), reduce parallelism
    if (res.loadPerCpu > 1.5) {
      adjusted = Math.max(2, Math.floor(adjusted / 2));
      if (jobId) {
        this.jobService.appendOutput(jobId, `   ⚠️ High CPU load (${res.loadAvg1m.toFixed(1)}), reducing to ${adjusted} parallel build(s)`);
      }
    }

    // For dotnet, check if we have at least 1.5GB free per build (reduced from 2GB)
    if (type === "dotnet" && res.freeMemoryGB < adjusted * 1.5) {
      adjusted = Math.max(2, Math.floor(res.freeMemoryGB / 1.5));
      if (jobId && adjusted < base) {
        this.jobService.appendOutput(jobId, `   ⚠️ Limited memory (${res.freeMemoryGB.toFixed(1)}GB free), running ${adjusted} parallel build(s)`);
      }
    }

    return Math.max(1, adjusted);
  }

  /**
   * Wait if system is under heavy load - only pause for extreme conditions
   */
  private async waitForResources(jobId: string, minFreeMemoryGB: number = 1): Promise<void> {
    let waited = false;
    let waitCount = 0;
    const maxWaits = 10; // Max 10 seconds of waiting (reduced from 30)

    while (waitCount < maxWaits) {
      const res = this.getSystemResources();

      // Only wait for extreme conditions - raised thresholds significantly
      if (res.freeMemoryGB >= minFreeMemoryGB && res.memoryUsagePercent < 95 && res.loadPerCpu < 2.0) {
        if (waited) {
          this.jobService.appendOutput(jobId, `   ✓ Resources available (${res.freeMemoryGB.toFixed(1)}GB free, ${res.memoryUsagePercent.toFixed(0)}% used)`);
        }
        return;
      }

      if (!waited) {
        this.jobService.appendOutput(jobId, `   ⏳ Waiting for resources (${res.freeMemoryGB.toFixed(1)}GB free, ${res.memoryUsagePercent.toFixed(0)}% mem, load ${res.loadAvg1m.toFixed(1)})...`);
        waited = true;
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
      waitCount++;
    }

    if (waited) {
      this.jobService.appendOutput(jobId, `   ⚠️ Timeout waiting for resources, proceeding anyway`);
    }
  }

  /**
   * Build all lambdas, grouped by type with appropriate parallelism
   */
  async buildAll(
    lambdas: LambdaInfo[],
    jobId: string,
    parallelism?: number
  ): Promise<BuildResult[]> {
    const cpuCount = os.cpus().length;
    const results: BuildResult[] = [];
    let completed = 0;

    // Group lambdas by type
    const byType = lambdas.reduce((acc, lambda) => {
      if (!acc[lambda.type]) acc[lambda.type] = [];
      acc[lambda.type].push(lambda);
      return acc;
    }, {} as Record<string, LambdaInfo[]>);

    this.jobService.appendOutput(jobId, `Building ${lambdas.length} lambdas (${cpuCount} CPUs available)`);
    this.jobService.appendOutput(jobId, `Types: ${Object.entries(byType).map(([t, l]) => `${t}(${l.length})`).join(", ")}`);

    // Info about .NET builds
    const dotnetCount = byType["dotnet"]?.length || 0;
    if (dotnetCount > 10) {
      this.jobService.appendOutput(jobId, `\n🚀 Building ${dotnetCount} .NET lambdas with aggressive parallelism`);
    }

    this.jobService.updateJobStatus(jobId, "running");

    // Log initial system resources
    const initialRes = this.getSystemResources();
    this.jobService.appendOutput(jobId, `System: ${initialRes.freeMemoryGB.toFixed(1)}GB free / ${initialRes.totalMemoryGB.toFixed(1)}GB total, load ${initialRes.loadAvg1m.toFixed(1)}`);

    // Build each type with appropriate parallelism
    for (const [type, typeLambdas] of Object.entries(byType)) {
      this.jobService.appendOutput(jobId, `\n>>> Building ${typeLambdas.length} ${type} lambdas`);

      // Process in batches
      let i = 0;
      while (i < typeLambdas.length) {
        // Check if job was cancelled
        const job = this.jobService.getJob(jobId);
        if (job?.status === "cancelled") {
          this.jobService.appendOutput(jobId, "\n[Build cancelled]");
          return results;
        }

        // Wait for resources if system is under stress (especially for heavy builds)
        if (type === "dotnet") {
          await this.waitForResources(jobId, 2);
        }

        // Get dynamic parallelism based on current resources
        const maxParallel = parallelism ?? this.getParallelismForType(type as LambdaInfo["type"], jobId);
        const batch = typeLambdas.slice(i, i + maxParallel);

        const batchResults = await Promise.allSettled(
          batch.map((lambda) =>
            this.buildLambda(lambda, jobId, (line) => {
              this.jobService.appendOutput(jobId, line);
            })
          )
        );

        for (const result of batchResults) {
          if (result.status === "fulfilled") {
            results.push(result.value);
          } else {
            results.push({
              name: "unknown",
              success: false,
              error: result.reason?.message || "Unknown error",
              duration: 0,
            });
          }
          completed++;
          this.jobService.updateJobProgress(jobId, Math.round((completed / lambdas.length) * 100));
        }

        i += maxParallel;

        // Minimal pause between batches - just enough to let the system catch up
        if (type === "dotnet" && i < typeLambdas.length) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    }

    // Summary
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    this.jobService.appendOutput(jobId, `\n=== Build Summary ===`);
    this.jobService.appendOutput(jobId, `Total: ${lambdas.length}, Success: ${successful}, Failed: ${failed}`);

    if (failed > 0) {
      this.jobService.appendOutput(jobId, `\nFailed lambdas:`);
      for (const result of results.filter((r) => !r.success)) {
        this.jobService.appendOutput(jobId, `  - ${result.name}: ${result.error}`);
      }
      this.jobService.updateJobStatus(jobId, "failed", `${failed} lambdas failed to build`);
    } else {
      this.jobService.updateJobStatus(jobId, "completed");
    }

    return results;
  }

  /**
   * Build lambdas by type
   */
  async buildByType(
    lambdas: LambdaInfo[],
    type: LambdaInfo["type"],
    jobId: string
  ): Promise<BuildResult[]> {
    const filtered = lambdas.filter((l) => l.type === type);
    return this.buildAll(filtered, jobId);
  }

  /**
   * Build a .NET lambda using dotnet lambda package
   */
  private async buildDotnetLambda(lambda: LambdaInfo, output: (line: string) => void): Promise<void> {
    output(`> dotnet lambda package --framework net8.0`);

    // Add ~/.dotnet/tools to PATH for dotnet-lambda global tool
    const dotnetToolsPath = path.join(os.homedir(), ".dotnet", "tools");
    const env = {
      ...process.env,
      PATH: `${dotnetToolsPath}:${process.env.PATH}`,
    };

    const proc = Bun.spawn(["dotnet", "lambda", "package", "--framework", "net8.0"], {
      cwd: lambda.path,
      stdout: "pipe",
      stderr: "pipe",
      env,
    });

    // Stream stdout
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) output(line);
      }
    }

    if (buffer.trim()) output(buffer);

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      // Read stderr
      const stderrText = await new Response(proc.stderr).text();
      throw new Error(stderrText || `Exit code ${exitCode}`);
    }
  }

  /**
   * Build a JS lambda (yarn install + zip)
   */
  private async buildJsLambda(lambda: LambdaInfo, output: (line: string) => void): Promise<void> {
    const deploymentZip = path.join(lambda.path, "deployment.zip");
    const tempDir = path.join(lambda.path, "temp_deploy");

    // Clean up
    output(`> Cleaning up previous build...`);
    await $`rm -rf ${tempDir} ${deploymentZip}`.quiet();

    // Install dependencies
    output(`> yarn install --frozen-lockfile`);
    const yarnProc = Bun.spawn(["yarn", "install", "--frozen-lockfile"], {
      cwd: lambda.path,
      stdout: "pipe",
      stderr: "pipe",
    });

    await this.streamOutput(yarnProc, output);

    if ((await yarnProc.exited) !== 0) {
      throw new Error("yarn install failed");
    }

    // Create temp directory and copy files
    output(`> Preparing deployment package...`);
    await $`mkdir -p ${tempDir}`.quiet();

    // Copy source files
    await $`cp -r ${lambda.path}/*.js ${lambda.path}/*.json ${tempDir}/ 2>/dev/null || true`.quiet();
    await $`cp -r ${lambda.path}/node_modules ${tempDir}/`.quiet();

    // Create zip
    output(`> Creating deployment.zip...`);
    await $`cd ${tempDir} && zip -rq ../deployment.zip .`.quiet();

    // Clean up temp
    await $`rm -rf ${tempDir}`.quiet();

    output(`> Deployment package created: ${deploymentZip}`);
  }

  /**
   * Build a Python lambda (copy + zip)
   */
  private async buildPythonLambda(lambda: LambdaInfo, output: (line: string) => void): Promise<void> {
    const deploymentZip = path.join(lambda.path, "deployment.zip");
    const stageDir = path.join(lambda.path, ".stage");

    // Clean up
    output(`> Cleaning up previous build...`);
    await $`rm -rf ${stageDir} ${deploymentZip}`.quiet();

    // Create stage directory
    await $`mkdir -p ${stageDir}`.quiet();

    // Copy files (excluding unwanted)
    output(`> Copying Python files...`);
    await $`rsync -a --exclude='.stage' --exclude='.venv' --exclude='__pycache__' --exclude='.git' --exclude='requirements.txt' --exclude='deployment.zip' --exclude='*.pyc' ${lambda.path}/ ${stageDir}/`.quiet();

    // Remove any pycache that slipped through
    await $`find ${stageDir} -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true`.quiet();
    await $`find ${stageDir} -name '*.pyc' -delete 2>/dev/null || true`.quiet();

    // Create zip
    output(`> Creating deployment.zip...`);
    await $`cd ${stageDir} && zip -rq ../deployment.zip .`.quiet();

    // Clean up
    await $`rm -rf ${stageDir}`.quiet();

    output(`> Deployment package created: ${deploymentZip}`);
  }

  /**
   * Build TypeScript edge lambda (yarn + tsc + zip)
   */
  private async buildTypescriptEdgeLambda(lambda: LambdaInfo, output: (line: string) => void): Promise<void> {
    const packagedDir = path.join(lambda.path, "packaged");
    const deploymentZip = path.join(packagedDir, "deployment.zip");

    // Ensure packaged directory exists
    await $`mkdir -p ${packagedDir}`.quiet();

    // Clean up previous deployment
    await $`rm -f ${deploymentZip}`.quiet();

    // Install all dependencies
    output(`> yarn install`);
    let proc = Bun.spawn(["yarn", "install"], {
      cwd: lambda.path,
      stdout: "pipe",
      stderr: "pipe",
    });
    await this.streamOutput(proc, output);
    if ((await proc.exited) !== 0) throw new Error("yarn install failed");

    // Compile TypeScript
    output(`> yarn tsc`);
    proc = Bun.spawn(["yarn", "tsc"], {
      cwd: lambda.path,
      stdout: "pipe",
      stderr: "pipe",
    });
    await this.streamOutput(proc, output);
    if ((await proc.exited) !== 0) throw new Error("tsc compilation failed");

    // Remove node_modules, reinstall production only
    output(`> Installing production dependencies only...`);
    await $`rm -rf ${lambda.path}/node_modules`.quiet();

    proc = Bun.spawn(["yarn", "install", "--production"], {
      cwd: lambda.path,
      stdout: "pipe",
      stderr: "pipe",
    });
    await this.streamOutput(proc, output);
    if ((await proc.exited) !== 0) throw new Error("yarn production install failed");

    // Create deployment zip
    output(`> Creating deployment.zip...`);

    // Add node_modules to zip
    await $`cd ${lambda.path} && zip -rq ${deploymentZip} node_modules`.quiet();

    // Add compiled source to zip
    await $`cd ${lambda.path}/build && zip -rq ${deploymentZip} src`.quiet();

    // Restore dev dependencies
    output(`> Restoring dev dependencies...`);
    proc = Bun.spawn(["yarn", "install"], {
      cwd: lambda.path,
      stdout: "pipe",
      stderr: "pipe",
    });
    await this.streamOutput(proc, output);

    output(`> Deployment package created: ${deploymentZip}`);
  }

  /**
   * Helper to stream process output
   */
  private async streamOutput(
    proc: ReturnType<typeof Bun.spawn>,
    output: (line: string) => void
  ): Promise<void> {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) output(line);
      }
    }

    if (buffer.trim()) output(buffer);
  }
}
