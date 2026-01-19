import { $ } from "bun";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import type { JobService } from "./jobService";
import type { LambdaInfo } from "./infraService";

const isWindows = os.platform() === "win32";
const yarnCmd = isWindows ? "yarn.cmd" : "yarn";

export interface SharedProject {
  name: string;
  path: string;
  csprojPath: string;
}

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
   * Discover shared .NET projects in the backend/Shared folder
   * These are commonly referenced by multiple lambdas
   */
  async discoverSharedProjects(backendPath: string): Promise<SharedProject[]> {
    const sharedDir = path.join(backendPath, "Shared");
    const projects: SharedProject[] = [];

    if (!fs.existsSync(sharedDir)) {
      return projects;
    }

    // Scan for .csproj files in Shared directory and subdirectories
    const scanDir = async (dir: string): Promise<void> => {
      try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            // Skip bin/obj directories
            if (entry.name !== "bin" && entry.name !== "obj") {
              await scanDir(fullPath);
            }
          } else if (entry.name.endsWith(".csproj")) {
            const name = entry.name.replace(".csproj", "");
            projects.push({
              name,
              path: dir,
              csprojPath: fullPath,
            });
          }
        }
      } catch {
        // Ignore errors
      }
    };

    await scanDir(sharedDir);
    return projects;
  }

  /**
   * Discover handler projects that are dependencies (not lambdas themselves but referenced)
   * These include projects like SMTP, DataLayer, PaymentGateway
   */
  async discoverDependencyHandlers(backendPath: string): Promise<SharedProject[]> {
    const handlersDir = path.join(backendPath, "Handlers");
    const projects: SharedProject[] = [];

    // Known dependency handlers (not lambda entry points but referenced by other handlers)
    const dependencyHandlerNames = ["SMTP", "DataLayer", "PaymentGateway"];

    if (!fs.existsSync(handlersDir)) {
      return projects;
    }

    try {
      const entries = await fs.promises.readdir(handlersDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && dependencyHandlerNames.includes(entry.name)) {
          const handlerDir = path.join(handlersDir, entry.name);
          const srcDir = path.join(handlerDir, "src", entry.name);

          if (fs.existsSync(srcDir)) {
            const csprojPath = path.join(srcDir, `${entry.name}.csproj`);
            if (fs.existsSync(csprojPath)) {
              projects.push({
                name: entry.name,
                path: srcDir,
                csprojPath,
              });
            }
          }
        }
      }
    } catch {
      // Ignore errors
    }

    return projects;
  }

  /**
   * Build all shared projects to pre-warm the build cache
   * This should be called before building lambdas in parallel
   */
  async buildSharedProjects(
    backendPath: string,
    jobId: string,
    onOutput?: (line: string) => void
  ): Promise<{ success: boolean; built: number; failed: number; duration: number }> {
    const startTime = Date.now();
    const output = onOutput || ((line: string) => this.jobService.appendOutput(jobId, line));

    output(`\n📦 Phase 1: Building shared .NET projects`);
    output(`This pre-compiles common dependencies so lambdas can build faster in parallel.\n`);

    // Discover shared projects
    const sharedProjects = await this.discoverSharedProjects(backendPath);
    const dependencyHandlers = await this.discoverDependencyHandlers(backendPath);
    const allSharedProjects = [...sharedProjects, ...dependencyHandlers];

    if (allSharedProjects.length === 0) {
      output(`No shared projects found in ${backendPath}/Shared`);
      return { success: true, built: 0, failed: 0, duration: Date.now() - startTime };
    }

    output(`Found ${sharedProjects.length} shared projects + ${dependencyHandlers.length} dependency handlers:`);
    for (const proj of allSharedProjects) {
      output(`  - ${proj.name}`);
    }
    output("");

    // Add ~/.dotnet/tools to PATH for dotnet
    const dotnetToolsPath = path.join(os.homedir(), ".dotnet", "tools");
    const env = {
      ...process.env,
      PATH: `${dotnetToolsPath}:${process.env.PATH}`,
    };

    let built = 0;
    let failed = 0;

    // Build each shared project sequentially (they may depend on each other)
    for (const proj of allSharedProjects) {
      output(`Building ${proj.name}...`);

      try {
        const proc = Bun.spawn(
          ["dotnet", "build", "-c", "Release", "--no-restore"],
          {
            cwd: proj.path,
            stdout: "pipe",
            stderr: "pipe",
            env,
          }
        );

        // First try to restore if no-restore fails
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
          // Try again with restore
          output(`  Restoring packages for ${proj.name}...`);
          const procWithRestore = Bun.spawn(
            ["dotnet", "build", "-c", "Release"],
            {
              cwd: proj.path,
              stdout: "pipe",
              stderr: "pipe",
              env,
            }
          );

          const exitCode2 = await procWithRestore.exited;
          if (exitCode2 !== 0) {
            const stderr = await new Response(procWithRestore.stderr).text();
            output(`  ✗ ${proj.name} failed: ${stderr.slice(0, 200)}`);
            failed++;
            continue;
          }
        }

        output(`  ✓ ${proj.name} built`);
        built++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        output(`  ✗ ${proj.name} failed: ${errorMsg}`);
        failed++;
      }
    }

    const duration = Date.now() - startTime;
    output(`\n✓ Shared projects: ${built} built, ${failed} failed (${(duration / 1000).toFixed(1)}s)\n`);

    return {
      success: failed === 0,
      built,
      failed,
      duration,
    };
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
   * Uses two-phase approach for .NET: build shared projects first, then lambdas in parallel
   */
  async buildAll(
    lambdas: LambdaInfo[],
    jobId: string,
    parallelism?: number,
    backendPath?: string
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
      this.jobService.appendOutput(jobId, `\n🚀 Building ${dotnetCount} .NET lambdas with two-phase approach`);
    }

    this.jobService.updateJobStatus(jobId, "running");

    // Log initial system resources
    const initialRes = this.getSystemResources();
    this.jobService.appendOutput(jobId, `System: ${initialRes.freeMemoryGB.toFixed(1)}GB free / ${initialRes.totalMemoryGB.toFixed(1)}GB total, load ${initialRes.loadAvg1m.toFixed(1)}`);

    // Phase 1: Pre-build shared projects for .NET lambdas
    if (dotnetCount > 0 && backendPath) {
      const sharedResult = await this.buildSharedProjects(backendPath, jobId);
      if (!sharedResult.success) {
        this.jobService.appendOutput(jobId, `⚠️ Some shared projects failed to build. Lambda builds may still work.`);
      }
      this.jobService.appendOutput(jobId, `\n🔨 Phase 2: Building individual lambdas in parallel\n`);
    }

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
   * For .NET lambdas, optionally pre-build shared projects first
   */
  async buildByType(
    lambdas: LambdaInfo[],
    type: LambdaInfo["type"],
    jobId: string,
    backendPath?: string
  ): Promise<BuildResult[]> {
    const filtered = lambdas.filter((l) => l.type === type);
    return this.buildAll(filtered, jobId, undefined, backendPath);
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
   * Cross-platform: Remove directory recursively
   */
  private async rmDir(dirPath: string): Promise<void> {
    try {
      await fs.promises.rm(dirPath, { recursive: true, force: true });
    } catch {
      // Ignore errors (directory might not exist)
    }
  }

  /**
   * Cross-platform: Remove file
   */
  private async rmFile(filePath: string): Promise<void> {
    try {
      await fs.promises.unlink(filePath);
    } catch {
      // Ignore errors (file might not exist)
    }
  }

  /**
   * Cross-platform: Create directory
   */
  private async mkDir(dirPath: string): Promise<void> {
    await fs.promises.mkdir(dirPath, { recursive: true });
  }

  /**
   * Cross-platform: Copy directory recursively
   */
  private async copyDir(src: string, dest: string): Promise<void> {
    await fs.promises.cp(src, dest, { recursive: true });
  }

  /**
   * Cross-platform: Copy files matching a pattern
   */
  private async copyFiles(srcDir: string, destDir: string, extensions: string[]): Promise<void> {
    try {
      const files = await fs.promises.readdir(srcDir);
      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (extensions.includes(ext)) {
          const srcPath = path.join(srcDir, file);
          const destPath = path.join(destDir, file);
          const stat = await fs.promises.stat(srcPath);
          if (stat.isFile()) {
            await fs.promises.copyFile(srcPath, destPath);
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  /**
   * Cross-platform: Create zip file
   */
  private async createZip(sourceDir: string, zipPath: string, output: (line: string) => void): Promise<void> {
    if (isWindows) {
      // Use PowerShell on Windows
      const proc = Bun.spawn(
        ["powershell", "-Command", `Compress-Archive -Path '${sourceDir}\\*' -DestinationPath '${zipPath}' -Force`],
        { stdout: "pipe", stderr: "pipe" }
      );
      await this.streamOutput(proc, output);
      if ((await proc.exited) !== 0) {
        throw new Error("PowerShell Compress-Archive failed");
      }
    } else {
      // Use zip on Unix
      await $`cd ${sourceDir} && zip -rq ${zipPath} .`.quiet();
    }
  }

  /**
   * Cross-platform: Add files to existing zip
   */
  private async addToZip(sourceDir: string, zipPath: string, output: (line: string) => void): Promise<void> {
    if (isWindows) {
      // Use PowerShell to update archive
      const proc = Bun.spawn(
        ["powershell", "-Command", `Compress-Archive -Path '${sourceDir}\\*' -Update -DestinationPath '${zipPath}'`],
        { stdout: "pipe", stderr: "pipe" }
      );
      await this.streamOutput(proc, output);
      if ((await proc.exited) !== 0) {
        throw new Error("PowerShell Compress-Archive update failed");
      }
    } else {
      await $`cd ${sourceDir} && zip -rq ${zipPath} .`.quiet();
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
    await this.rmDir(tempDir);
    await this.rmFile(deploymentZip);

    // Install dependencies
    output(`> yarn install --frozen-lockfile`);
    const yarnProc = Bun.spawn([yarnCmd, "install", "--frozen-lockfile"], {
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
    await this.mkDir(tempDir);

    // Copy source files (.js and .json)
    await this.copyFiles(lambda.path, tempDir, [".js", ".json"]);

    // Copy node_modules
    const nodeModulesSrc = path.join(lambda.path, "node_modules");
    const nodeModulesDest = path.join(tempDir, "node_modules");
    if (fs.existsSync(nodeModulesSrc)) {
      await this.copyDir(nodeModulesSrc, nodeModulesDest);
    }

    // Create zip
    output(`> Creating deployment.zip...`);
    await this.createZip(tempDir, deploymentZip, output);

    // Clean up temp
    await this.rmDir(tempDir);

    output(`> Deployment package created: ${deploymentZip}`);
  }

  /**
   * Cross-platform: Copy directory excluding certain patterns
   */
  private async copyDirExcluding(
    src: string,
    dest: string,
    excludePatterns: string[]
  ): Promise<void> {
    const entries = await fs.promises.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      // Check if should exclude
      const shouldExclude = excludePatterns.some((pattern) => {
        if (pattern.startsWith("*.")) {
          return entry.name.endsWith(pattern.slice(1));
        }
        return entry.name === pattern;
      });

      if (shouldExclude) continue;

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.mkDir(destPath);
        await this.copyDirExcluding(srcPath, destPath, excludePatterns);
      } else {
        await fs.promises.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Build a Python lambda (copy + zip)
   */
  private async buildPythonLambda(lambda: LambdaInfo, output: (line: string) => void): Promise<void> {
    const deploymentZip = path.join(lambda.path, "deployment.zip");
    const stageDir = path.join(lambda.path, ".stage");

    // Clean up
    output(`> Cleaning up previous build...`);
    await this.rmDir(stageDir);
    await this.rmFile(deploymentZip);

    // Create stage directory
    await this.mkDir(stageDir);

    // Copy files (excluding unwanted)
    output(`> Copying Python files...`);
    const excludePatterns = [".stage", ".venv", "__pycache__", ".git", "requirements.txt", "deployment.zip", "*.pyc"];
    await this.copyDirExcluding(lambda.path, stageDir, excludePatterns);

    // Create zip
    output(`> Creating deployment.zip...`);
    await this.createZip(stageDir, deploymentZip, output);

    // Clean up
    await this.rmDir(stageDir);

    output(`> Deployment package created: ${deploymentZip}`);
  }

  /**
   * Build TypeScript edge lambda (yarn + tsc + zip)
   */
  private async buildTypescriptEdgeLambda(lambda: LambdaInfo, output: (line: string) => void): Promise<void> {
    const packagedDir = path.join(lambda.path, "packaged");
    const deploymentZip = path.join(packagedDir, "deployment.zip");
    const tempDir = path.join(lambda.path, ".ts_edge_temp");

    // Ensure packaged directory exists
    await this.mkDir(packagedDir);

    // Clean up previous deployment
    await this.rmFile(deploymentZip);
    await this.rmDir(tempDir);

    // Install all dependencies
    output(`> yarn install`);
    let proc = Bun.spawn([yarnCmd, "install"], {
      cwd: lambda.path,
      stdout: "pipe",
      stderr: "pipe",
    });
    await this.streamOutput(proc, output);
    if ((await proc.exited) !== 0) throw new Error("yarn install failed");

    // Compile TypeScript
    output(`> yarn tsc`);
    proc = Bun.spawn([yarnCmd, "tsc"], {
      cwd: lambda.path,
      stdout: "pipe",
      stderr: "pipe",
    });
    await this.streamOutput(proc, output);
    if ((await proc.exited) !== 0) throw new Error("tsc compilation failed");

    // Remove node_modules, reinstall production only
    output(`> Installing production dependencies only...`);
    await this.rmDir(path.join(lambda.path, "node_modules"));

    proc = Bun.spawn([yarnCmd, "install", "--production"], {
      cwd: lambda.path,
      stdout: "pipe",
      stderr: "pipe",
    });
    await this.streamOutput(proc, output);
    if ((await proc.exited) !== 0) throw new Error("yarn production install failed");

    // Create temp directory with both node_modules and compiled source
    output(`> Preparing deployment package...`);
    await this.mkDir(tempDir);

    // Copy node_modules to temp
    const nodeModulesSrc = path.join(lambda.path, "node_modules");
    if (fs.existsSync(nodeModulesSrc)) {
      await this.copyDir(nodeModulesSrc, path.join(tempDir, "node_modules"));
    }

    // Copy compiled source to temp
    const buildSrcDir = path.join(lambda.path, "build", "src");
    if (fs.existsSync(buildSrcDir)) {
      await this.copyDir(buildSrcDir, path.join(tempDir, "src"));
    }

    // Create deployment zip
    output(`> Creating deployment.zip...`);
    await this.createZip(tempDir, deploymentZip, output);

    // Clean up temp
    await this.rmDir(tempDir);

    // Restore dev dependencies
    output(`> Restoring dev dependencies...`);
    proc = Bun.spawn([yarnCmd, "install"], {
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
