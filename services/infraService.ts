import {
  CloudFormationClient,
  ListStacksCommand,
  DescribeStacksCommand,
  StackStatus,
} from "@aws-sdk/client-cloudformation";
import {
  LambdaClient,
  ListFunctionsCommand,
  GetFunctionCommand,
  GetFunctionConfigurationCommand,
  type FunctionConfiguration,
} from "@aws-sdk/client-lambda";
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
  DescribeLogStreamsCommand,
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import {
  AppSyncClient,
  ListGraphqlApisCommand,
} from "@aws-sdk/client-appsync";
import { Glob } from "bun";
import * as path from "path";

export interface StackInfo {
  name: string;
  status: string;
  lastUpdated: Date | null;
  stackType: string; // frontend, backend, etc.
}

export interface Environment {
  suffix: string;
  stacks: StackInfo[];
}

export interface InfraConfig {
  repoPath: string;
  infraPath: string;
  backendPath: string;
  stage: "dev" | "prod" | "staging" | "int" | "demo";
  currentEnv: string | null;
}

export interface LambdaInfo {
  name: string;
  type: "dotnet" | "js" | "python" | "typescript-edge";
  path: string;
  outputPath: string;
  hasDeploymentZip: boolean;
}

export interface AwsLambdaInfo {
  functionName: string;
  localName: string | null; // Mapped local handler name
  runtime: string | null;
  memorySize: number | null;
  timeout: number | null;
  lastModified: string | null;
  codeSize: number | null;
  handler: string | null;
  description: string | null;
  environment: string | null; // Extracted from function name
  stackType: string | null; // backend, frontend, etc.
}

// Stack types we recognize
const STACK_TYPES = [
  "frontend",
  "backend",
  "payment-frontend",
  "secondary-backend",
  "backend-beanstalk",
];

// Regex to match our stack naming pattern
const STACK_NAME_REGEX = new RegExp(
  `^(${STACK_TYPES.join("|")})-(.+)$`
);

export class InfraService {
  private cfnClient: CloudFormationClient;
  private lambdaClient: LambdaClient;
  private logsClient: CloudWatchLogsClient;
  private appSyncClient: AppSyncClient;
  private region: string;

  constructor(region: string = "us-east-2") {
    this.region = region;
    this.cfnClient = new CloudFormationClient({ region });
    this.lambdaClient = new LambdaClient({ region });
    this.logsClient = new CloudWatchLogsClient({ region });
    this.appSyncClient = new AppSyncClient({ region });
  }

  /**
   * Derive infrastructure paths from a repository path
   */
  getInfraPaths(repoPath: string): { infraPath: string; backendPath: string } | null {
    const infraPath = path.join(repoPath, "infrastructure");
    const backendPath = path.join(repoPath, "backend");

    // Check if infrastructure folder exists
    const infraExists = Bun.file(path.join(infraPath, "cdk.json")).size > 0;
    if (!infraExists) {
      return null;
    }

    return { infraPath, backendPath };
  }

  /**
   * Check if a suffix looks like a valid environment name (not a nested stack)
   * Valid: damien-1, bill, master, dev, staging, prod, test-123
   * Invalid: damien-1-Dynamic-NestedStack-ABC123, anything with "Nested", random hashes
   */
  private isValidEnvironmentSuffix(suffix: string): boolean {
    // Reject if contains "Nested" (case insensitive)
    if (/nested/i.test(suffix)) return false;

    // Reject if contains "Dynamic" (case insensitive) - usually nested stacks
    if (/dynamic/i.test(suffix)) return false;

    // Reject if it looks like a CDK-generated hash (random alphanumeric at end)
    // Pattern: ends with something like -ABC123XYZ or has multiple segments with random chars
    if (/[A-Z0-9]{8,}$/i.test(suffix)) return false;

    // Reject if it has more than 2 dashes (e.g., "damien-1-SomethingElse-...")
    const dashCount = (suffix.match(/-/g) || []).length;
    if (dashCount > 1) return false;

    // Reject if too long (simple env names are usually short)
    if (suffix.length > 20) return false;

    // Accept simple patterns: word, word-number, or known env names
    // Examples: master, damien-1, bill, dev, staging-2
    return /^[a-z][a-z0-9]*(-[a-z0-9]+)?$/i.test(suffix);
  }

  /**
   * List all CloudFormation stacks and extract unique environments
   */
  async listEnvironments(): Promise<Environment[]> {
    const stacks = await this.listAllStacks();
    const envMap = new Map<string, StackInfo[]>();

    for (const stack of stacks) {
      const match = stack.name.match(STACK_NAME_REGEX);
      if (match) {
        const [, stackType, suffix] = match;

        // Skip nested stacks and dynamic stacks
        if (!this.isValidEnvironmentSuffix(suffix)) continue;

        if (!envMap.has(suffix)) {
          envMap.set(suffix, []);
        }
        envMap.get(suffix)!.push({
          ...stack,
          stackType,
        });
      }
    }

    // Convert to array and sort by suffix
    return Array.from(envMap.entries())
      .map(([suffix, stacks]) => ({ suffix, stacks }))
      .sort((a, b) => a.suffix.localeCompare(b.suffix));
  }

  /**
   * Get all stacks from CloudFormation
   */
  async listAllStacks(): Promise<StackInfo[]> {
    const stacks: StackInfo[] = [];
    let nextToken: string | undefined;

    // Only include active stack statuses
    const activeStatuses = [
      StackStatus.CREATE_COMPLETE,
      StackStatus.UPDATE_COMPLETE,
      StackStatus.UPDATE_ROLLBACK_COMPLETE,
      StackStatus.ROLLBACK_COMPLETE,
      StackStatus.CREATE_IN_PROGRESS,
      StackStatus.UPDATE_IN_PROGRESS,
      StackStatus.DELETE_IN_PROGRESS,
    ];

    do {
      const command = new ListStacksCommand({
        NextToken: nextToken,
        StackStatusFilter: activeStatuses,
      });

      const response = await this.cfnClient.send(command);

      for (const summary of response.StackSummaries || []) {
        if (summary.StackName) {
          stacks.push({
            name: summary.StackName,
            status: summary.StackStatus || "UNKNOWN",
            lastUpdated: summary.LastUpdatedTime || summary.CreationTime || null,
            stackType: "",
          });
        }
      }

      nextToken = response.NextToken;
    } while (nextToken);

    return stacks;
  }

  /**
   * Get detailed info for a specific stack
   */
  async getStackStatus(stackName: string): Promise<StackInfo | null> {
    try {
      const command = new DescribeStacksCommand({
        StackName: stackName,
      });

      const response = await this.cfnClient.send(command);
      const stack = response.Stacks?.[0];

      if (!stack) return null;

      const match = stackName.match(STACK_NAME_REGEX);
      const stackType = match ? match[1] : "";

      return {
        name: stack.StackName || stackName,
        status: stack.StackStatus || "UNKNOWN",
        lastUpdated: stack.LastUpdatedTime || stack.CreationTime || null,
        stackType,
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get stacks for a specific environment suffix
   */
  async getStacksForEnvironment(suffix: string): Promise<StackInfo[]> {
    const allStacks = await this.listAllStacks();
    return allStacks.filter((stack) => {
      const match = stack.name.match(STACK_NAME_REGEX);
      return match && match[2] === suffix;
    }).map((stack) => {
      const match = stack.name.match(STACK_NAME_REGEX);
      return {
        ...stack,
        stackType: match ? match[1] : "",
      };
    });
  }

  /**
   * Discover all lambdas in the backend folder
   */
  async discoverLambdas(backendPath: string): Promise<LambdaInfo[]> {
    const lambdas: LambdaInfo[] = [];

    // 1. Discover .NET handlers
    const handlersPath = path.join(backendPath, "Handlers");
    const dotnetGlob = new Glob("*/src/*/*.csproj");

    for await (const file of dotnetGlob.scan(handlersPath)) {
      const parts = file.split(path.sep);
      const handlerName = parts[0];

      // Skip edge lambdas (they're TypeScript)
      if (handlerName === "ViewerRequest" || handlerName === "OriginRequest") {
        continue;
      }

      const handlerPath = path.join(handlersPath, handlerName);
      const projectDir = path.join(handlersPath, path.dirname(file));
      const outputPath = path.join(projectDir, "bin", "Release", "net8.0", `${parts[2].replace(".csproj", "")}.zip`);

      lambdas.push({
        name: handlerName,
        type: "dotnet",
        path: projectDir,
        outputPath,
        hasDeploymentZip: await this.fileExists(outputPath),
      });
    }

    // 2. Discover TypeScript edge lambdas
    for (const edgeLambda of ["ViewerRequest", "OriginRequest"]) {
      const lambdaPath = path.join(handlersPath, edgeLambda);
      const outputPath = path.join(lambdaPath, "packaged", "deployment.zip");

      if (await this.dirExists(lambdaPath)) {
        lambdas.push({
          name: edgeLambda,
          type: "typescript-edge",
          path: lambdaPath,
          outputPath,
          hasDeploymentZip: await this.fileExists(outputPath),
        });
      }
    }

    // 3. Discover JS lambdas
    const jsLambdasPath = path.join(backendPath, "lambdas", "js");
    const jsGlob = new Glob("*/package.json");

    for await (const file of jsGlob.scan(jsLambdasPath)) {
      const lambdaName = path.dirname(file);
      const lambdaPath = path.join(jsLambdasPath, lambdaName);
      const outputPath = path.join(lambdaPath, "deployment.zip");

      lambdas.push({
        name: lambdaName,
        type: "js",
        path: lambdaPath,
        outputPath,
        hasDeploymentZip: await this.fileExists(outputPath),
      });
    }

    // 4. Discover Python lambda (RecSys)
    const pythonPath = path.join(backendPath, "lambdas", "python", "RecSys");
    const pythonOutputPath = path.join(pythonPath, "deployment.zip");

    if (await this.dirExists(pythonPath)) {
      lambdas.push({
        name: "RecSys",
        type: "python",
        path: pythonPath,
        outputPath: pythonOutputPath,
        hasDeploymentZip: await this.fileExists(pythonOutputPath),
      });
    }

    // Sort by type, then name
    return lambdas.sort((a, b) => {
      if (a.type !== b.type) {
        const typeOrder = ["dotnet", "typescript-edge", "js", "python"];
        return typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type);
      }
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      const file = Bun.file(filePath);
      return await file.exists();
    } catch {
      return false;
    }
  }

  /**
   * Check if a directory exists
   */
  private async dirExists(dirPath: string): Promise<boolean> {
    try {
      const stat = await Bun.file(path.join(dirPath, ".")).exists();
      // Try to check if it's a directory by looking for any file
      const glob = new Glob("*");
      for await (const _ of glob.scan(dirPath)) {
        return true;
      }
      return true; // Empty directory
    } catch {
      return false;
    }
  }

  /**
   * Parse AWS Lambda function name to extract environment and stack type
   * Local name matching is done separately by checking against known local names
   */
  parseAwsFunctionName(functionName: string, knownEnvironment?: string): {
    stackType: string | null;
    environment: string | null;
    localName: string | null;
  } {
    // Try to match stack type prefix
    for (const stackType of STACK_TYPES) {
      if (functionName.toLowerCase().startsWith(`${stackType.toLowerCase()}-`)) {
        const remainder = functionName.slice(stackType.length + 1);

        // If we know the environment, extract it
        if (knownEnvironment) {
          const envLower = knownEnvironment.toLowerCase();
          const remainderLower = remainder.toLowerCase();

          if (remainderLower.startsWith(envLower + "-") || remainderLower.includes(`-${envLower}-`)) {
            return { stackType, environment: knownEnvironment, localName: null };
          }
        }

        // Try to extract environment from common patterns
        const parts = remainder.split("-");
        if (parts.length >= 2) {
          // Environment is typically like "damien-1" or "master"
          // Try to find a numeric suffix pattern for environment
          for (let i = 1; i <= Math.min(3, parts.length - 1); i++) {
            const potentialEnv = parts.slice(0, i).join("-");
            // Check if this looks like an environment (e.g., ends with number or is a known pattern)
            if (/\d$/.test(potentialEnv) || ["master", "main", "dev", "staging", "prod"].includes(potentialEnv.toLowerCase())) {
              return { stackType, environment: potentialEnv, localName: null };
            }
          }
          // Fallback: first part is likely part of the env
          return { stackType, environment: parts[0], localName: null };
        }
      }
    }
    return { stackType: null, environment: null, localName: null };
  }

  /**
   * Find which local lambda name matches an AWS function name (case insensitive)
   * Checks if any local name appears in the AWS function name
   */
  findMatchingLocalName(awsFunctionName: string, localNames: string[]): string | null {
    const awsNameLower = awsFunctionName.toLowerCase();

    // Sort by length descending to match longer names first (e.g., "BulkLoadCreator" before "BulkLoad")
    const sortedNames = [...localNames].sort((a, b) => b.length - a.length);

    for (const localName of sortedNames) {
      if (awsNameLower.includes(localName.toLowerCase())) {
        return localName;
      }
    }
    return null;
  }

  /**
   * List all AWS Lambda functions, filtered by environment (case insensitive)
   * Only returns lambdas whose name contains the environment string
   */
  async listAwsLambdas(environmentFilter?: string): Promise<AwsLambdaInfo[]> {
    const functions: AwsLambdaInfo[] = [];
    let nextMarker: string | undefined;

    do {
      const command = new ListFunctionsCommand({
        Marker: nextMarker,
        MaxItems: 50,
      });

      const response = await this.lambdaClient.send(command);

      for (const fn of response.Functions || []) {
        if (!fn.FunctionName) continue;

        // Filter: only include lambdas that contain the environment in their name (case insensitive)
        if (environmentFilter) {
          const nameContainsEnv = fn.FunctionName.toLowerCase().includes(environmentFilter.toLowerCase());
          if (!nameContainsEnv) continue;
        }

        const parsed = this.parseAwsFunctionName(fn.FunctionName, environmentFilter || undefined);

        functions.push({
          functionName: fn.FunctionName,
          localName: parsed.localName,
          runtime: fn.Runtime || null,
          memorySize: fn.MemorySize || null,
          timeout: fn.Timeout || null,
          lastModified: fn.LastModified || null,
          codeSize: fn.CodeSize || null,
          handler: fn.Handler || null,
          description: fn.Description || null,
          environment: parsed.environment,
          stackType: parsed.stackType,
        });
      }

      nextMarker = response.NextMarker;
    } while (nextMarker);

    // Sort by function name
    return functions.sort((a, b) => a.functionName.localeCompare(b.functionName));
  }

  /**
   * Get detailed info for a specific Lambda function
   */
  async getAwsLambdaDetails(functionName: string): Promise<{
    config: AwsLambdaInfo;
    envVars: Record<string, string>;
  } | null> {
    try {
      const command = new GetFunctionConfigurationCommand({
        FunctionName: functionName,
      });

      const fn = await this.lambdaClient.send(command);
      const parsed = this.parseAwsFunctionName(functionName);

      return {
        config: {
          functionName,
          localName: parsed.localName,
          runtime: fn.Runtime || null,
          memorySize: fn.MemorySize || null,
          timeout: fn.Timeout || null,
          lastModified: fn.LastModified || null,
          codeSize: fn.CodeSize || null,
          handler: fn.Handler || null,
          description: fn.Description || null,
          environment: parsed.environment,
          stackType: parsed.stackType,
        },
        envVars: fn.Environment?.Variables || {},
      };
    } catch {
      return null;
    }
  }

  /**
   * Map local lambda names to AWS function names for a given environment
   */
  async mapLocalToAws(
    localLambdas: LambdaInfo[],
    environment: string
  ): Promise<Map<string, string>> {
    const awsLambdas = await this.listAwsLambdas(environment);
    const mapping = new Map<string, string>();

    for (const local of localLambdas) {
      const aws = awsLambdas.find((a) => a.localName === local.name);
      if (aws) {
        mapping.set(local.name, aws.functionName);
      }
    }

    return mapping;
  }

  /**
   * Run a git command and return the output
   */
  private async runGitCommand(args: string[], cwd: string): Promise<string | null> {
    try {
      const proc = Bun.spawn(["git", ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      });

      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) return null;
      return output;
    } catch {
      return null;
    }
  }

  /**
   * Parse a .csproj file to find ProjectReference dependencies
   * Returns array of absolute paths to referenced projects
   */
  async parseCsprojDependencies(csprojPath: string): Promise<string[]> {
    try {
      const content = await Bun.file(csprojPath).text();
      const dependencies: string[] = [];

      // Match ProjectReference Include="..."
      const regex = /<ProjectReference\s+Include="([^"]+)"/g;
      let match;

      while ((match = regex.exec(content)) !== null) {
        const relativePath = match[1].replace(/\\/g, "/"); // Normalize Windows paths
        const absolutePath = path.resolve(path.dirname(csprojPath), relativePath);
        dependencies.push(path.dirname(absolutePath));
      }

      return dependencies;
    } catch {
      return [];
    }
  }

  /**
   * Get all dependencies for a .NET lambda (recursive)
   * Returns set of directory paths that the lambda depends on
   */
  async getDotnetDependencies(lambdaPath: string, visited = new Set<string>()): Promise<Set<string>> {
    const dependencies = new Set<string>();
    dependencies.add(lambdaPath);

    if (visited.has(lambdaPath)) return dependencies;
    visited.add(lambdaPath);

    // Find .csproj file in the lambda path
    const csprojGlob = new Glob("*.csproj");
    for await (const csproj of csprojGlob.scan(lambdaPath)) {
      const csprojPath = path.join(lambdaPath, csproj);
      const deps = await this.parseCsprojDependencies(csprojPath);

      for (const dep of deps) {
        dependencies.add(dep);
        // Recursively get dependencies of dependencies
        const subDeps = await this.getDotnetDependencies(dep, visited);
        for (const subDep of subDeps) {
          dependencies.add(subDep);
        }
      }
    }

    return dependencies;
  }

  /**
   * Get all changed files from git status
   * Returns array of relative file paths that have been modified/added/deleted
   */
  async getChangedFiles(repoRoot: string): Promise<string[]> {
    // Get both staged and unstaged changes (no -uall to avoid memory issues on large repos)
    const output = await this.runGitCommand(
      ["status", "--porcelain"],
      repoRoot
    );

    if (!output) return [];

    const changedFiles: string[] = [];
    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      // Format: "XY filename" or "XY original -> renamed"
      const file = line.slice(3).split(" -> ").pop()?.trim();
      if (file) {
        changedFiles.push(file);
      }
    }

    return changedFiles;
  }

  /**
   * Build a map of lambda name -> set of directory paths it depends on
   */
  async buildDependencyMap(lambdas: LambdaInfo[]): Promise<Map<string, Set<string>>> {
    const depMap = new Map<string, Set<string>>();

    for (const lambda of lambdas) {
      if (lambda.type === "dotnet") {
        const deps = await this.getDotnetDependencies(lambda.path);
        depMap.set(lambda.name, deps);
      } else {
        // Non-.NET lambdas just depend on their own directory
        depMap.set(lambda.name, new Set([lambda.path]));
      }
    }

    return depMap;
  }

  /**
   * Check dirty status for all lambdas using git status
   * Much faster than checking each directory individually
   */
  async checkAllLambdasDirty(
    lambdas: LambdaInfo[],
    buildInfo: Map<string, { lastBuiltAt: number | null }>,
    repoRoot: string
  ): Promise<Map<string, { isDirty: boolean; reason?: string }>> {
    const results = new Map<string, { isDirty: boolean; reason?: string }>();

    // Get all changed files once
    const changedFiles = await this.getChangedFiles(repoRoot);

    // Build dependency map for all lambdas
    const depMap = await this.buildDependencyMap(lambdas);

    // Check each lambda
    for (const lambda of lambdas) {
      const info = buildInfo.get(lambda.name);

      // If never built, it's dirty
      if (!info?.lastBuiltAt) {
        results.set(lambda.name, { isDirty: true, reason: "Never built" });
        continue;
      }

      // Get dependencies for this lambda
      const deps = depMap.get(lambda.name) || new Set([lambda.path]);

      // Check if any changed file is within a dependency directory
      let dirtyReason: string | undefined;
      for (const changedFile of changedFiles) {
        const absoluteChangedPath = path.join(repoRoot, changedFile);

        for (const depPath of deps) {
          if (absoluteChangedPath.startsWith(depPath + path.sep) || absoluteChangedPath === depPath) {
            const depName = path.basename(depPath);
            if (depPath === lambda.path) {
              dirtyReason = "Source changed";
            } else {
              dirtyReason = `Dependency changed: ${depName}`;
            }
            break;
          }
        }

        if (dirtyReason) break;
      }

      results.set(lambda.name, {
        isDirty: !!dirtyReason,
        reason: dirtyReason,
      });
    }

    return results;
  }

  /**
   * Get the CloudWatch log group name for a Lambda function
   */
  getLambdaLogGroupName(functionName: string): string {
    return `/aws/lambda/${functionName}`;
  }

  /**
   * Get recent log streams for a Lambda function
   */
  async getRecentLogStreams(functionName: string, limit: number = 5): Promise<string[]> {
    const logGroupName = this.getLambdaLogGroupName(functionName);

    try {
      const command = new DescribeLogStreamsCommand({
        logGroupName,
        orderBy: "LastEventTime",
        descending: true,
        limit,
      });

      const response = await this.logsClient.send(command);
      return (response.logStreams || [])
        .filter((s) => s.logStreamName)
        .map((s) => s.logStreamName!);
    } catch (error) {
      console.error("Failed to get log streams:", error);
      return [];
    }
  }

  /**
   * Filter log events from a Lambda function's log group
   * Returns events from the last N minutes
   */
  async filterLambdaLogs(
    functionName: string,
    options: {
      startTime?: number; // Unix timestamp ms
      endTime?: number;
      filterPattern?: string;
      limit?: number;
    } = {}
  ): Promise<Array<{ timestamp: number; message: string; logStreamName: string }>> {
    const logGroupName = this.getLambdaLogGroupName(functionName);
    const {
      startTime = Date.now() - 30 * 60 * 1000, // Default: last 30 minutes
      endTime = Date.now(),
      filterPattern,
      limit = 100,
    } = options;

    try {
      const command = new FilterLogEventsCommand({
        logGroupName,
        startTime,
        endTime,
        filterPattern,
        limit,
      });

      const response = await this.logsClient.send(command);

      return (response.events || []).map((event) => ({
        timestamp: event.timestamp || 0,
        message: event.message || "",
        logStreamName: event.logStreamName || "",
      }));
    } catch (error) {
      console.error("Failed to filter logs:", error);
      throw error;
    }
  }

  /**
   * Tail logs - continuously fetch new logs
   * Returns an async generator that yields log events
   */
  async *tailLambdaLogs(
    functionName: string,
    options: {
      startTime?: number;
      pollIntervalMs?: number;
      signal?: AbortSignal;
    } = {}
  ): AsyncGenerator<{ timestamp: number; message: string; logStreamName: string }> {
    const logGroupName = this.getLambdaLogGroupName(functionName);
    const { pollIntervalMs = 2000, signal } = options;
    let startTime = options.startTime || Date.now(); // Default: start from now (live tail)
    let lastEventTime = startTime;

    while (!signal?.aborted) {
      try {
        const command = new FilterLogEventsCommand({
          logGroupName,
          startTime: startTime,
          limit: 100,
        });

        const response = await this.logsClient.send(command);

        for (const event of response.events || []) {
          if (event.timestamp && event.timestamp > lastEventTime) {
            lastEventTime = event.timestamp;
          }
          yield {
            timestamp: event.timestamp || 0,
            message: event.message || "",
            logStreamName: event.logStreamName || "",
          };
        }

        // Move start time forward to avoid duplicates, add 1ms
        if (response.events && response.events.length > 0) {
          startTime = lastEventTime + 1;
        }
      } catch (error: any) {
        // If log group doesn't exist, yield an error message and stop
        if (error.name === "ResourceNotFoundException") {
          yield {
            timestamp: Date.now(),
            message: `Log group ${logGroupName} not found. The Lambda may not have been invoked yet.`,
            logStreamName: "",
          };
          return;
        }
        throw error;
      }

      // Wait before polling again
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  /**
   * Get all AppSync APIs (handles pagination)
   */
  private async getAllAppSyncApis() {
    const allApis: Array<{
      name: string;
      apiId: string;
      uris: Record<string, string> | undefined;
    }> = [];

    let nextToken: string | undefined;

    do {
      const command = new ListGraphqlApisCommand({
        nextToken,
        maxResults: 25,
      });
      const response = await this.appSyncClient.send(command);

      if (response.graphqlApis) {
        for (const api of response.graphqlApis) {
          allApis.push({
            name: api.name || "Unknown",
            apiId: api.apiId || "",
            uris: api.uris,
          });
        }
      }

      nextToken = response.nextToken;
    } while (nextToken);

    return allApis;
  }

  /**
   * Get the AppSync GraphQL URL for a given environment suffix
   */
  async getAppSyncUrl(envSuffix: string): Promise<string | null> {
    try {
      const apis = await this.getAllAppSyncApis();
      const suffix = envSuffix.toLowerCase();

      console.log(`Looking for AppSync API matching suffix: "${suffix}"`);
      console.log(`Available APIs: ${apis.map(a => a.name).join(", ")}`);

      // Try different matching strategies
      const matchingApi = apis.find((api) => {
        const name = api.name.toLowerCase();

        // Exact suffix match at end (e.g., "myapp-damien-1" matches "damien-1")
        if (name.endsWith(`-${suffix}`)) return true;

        // Suffix appears in name (e.g., "damien-1-api" matches "damien-1")
        if (name.includes(suffix)) return true;

        // Handle case where suffix might have extra formatting
        // e.g., "damien1" matches "damien-1"
        const normalizedSuffix = suffix.replace(/-/g, "");
        const normalizedName = name.replace(/-/g, "");
        if (normalizedName.includes(normalizedSuffix)) return true;

        return false;
      });

      if (matchingApi) {
        console.log(`Found matching API: ${matchingApi.name}`);
        return matchingApi.uris?.GRAPHQL || null;
      }

      console.log(`No matching API found for suffix: ${suffix}`);
      return null;
    } catch (error) {
      console.error("Failed to get AppSync URL:", error);
      return null;
    }
  }

  /**
   * List all AppSync APIs to help identify the right one
   */
  async listAppSyncApis(): Promise<Array<{ name: string; url: string | null }>> {
    try {
      const apis = await this.getAllAppSyncApis();

      return apis.map((api) => ({
        name: api.name,
        url: api.uris?.GRAPHQL || null,
      }));
    } catch (error) {
      console.error("Failed to list AppSync APIs:", error);
      return [];
    }
  }
}
