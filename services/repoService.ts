import { homedir } from "os";
import { join } from "path";
import { readdir, stat } from "fs/promises";

export interface Repo {
  id: number;
  path: string;
  name: string;
  isWsl: boolean;
  lastScanned: Date;
}

export interface RepoServiceOptions {
  searchTerm?: string;
}

export class RepoService {
  private searchTerm: string;

  constructor(options: RepoServiceOptions = {}) {
    this.searchTerm = options.searchTerm || "cassadol";
  }

  /**
   * Detect if running inside a devcontainer or Docker container
   */
  private async isContainer(): Promise<boolean> {
    try {
      // Check for .dockerenv file (Docker) - file is typically empty, so check existence not size
      if (await Bun.file("/.dockerenv").exists()) {
        return true;
      }
    } catch {}

    // Check for container env vars
    if (Bun.env.REMOTE_CONTAINERS || Bun.env.CODESPACES || Bun.env.CONTAINER_ID) {
      return true;
    }

    return false;
  }

  /**
   * Get directories to scan based on platform
   * includeAllRepos: when true, include any git repo found (not just search term matches)
   */
  private async getScanDirectories(): Promise<{ path: string; isWsl: boolean; includeAllRepos: boolean }[]> {
    const dirs: { path: string; isWsl: boolean; includeAllRepos: boolean }[] = [];
    const home = homedir();

    if (await this.isContainer()) {
      // Container/devcontainer: scan /workspaces and home
      // Include all git repos in container workspace paths (repos may not match search term)
      dirs.push({ path: home, isWsl: false, includeAllRepos: true });
      if (home !== "/workspaces") {
        dirs.push({ path: "/workspaces", isWsl: false, includeAllRepos: true });
      }
    } else {
      // WSL: scan home + Windows mounts
      dirs.push({ path: home, isWsl: true, includeAllRepos: false });
      const windowsMounts = ["/mnt/c/Users", "/mnt/d/Users"];
      for (const mount of windowsMounts) {
        dirs.push({ path: mount, isWsl: false, includeAllRepos: false });
      }
    }

    return dirs;
  }

  /**
   * Check if a directory is a git repository
   */
  private async isGitRepo(dirPath: string): Promise<boolean> {
    try {
      const gitDir = join(dirPath, ".git");
      const stats = await stat(gitDir);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Recursively scan a directory for repos matching the search term
   */
  private async scanDirectory(
    basePath: string,
    isWsl: boolean,
    maxDepth: number = 4,
    currentDepth: number = 0,
    includeAllRepos: boolean = false
  ): Promise<Omit<Repo, "id" | "lastScanned">[]> {
    const repos: Omit<Repo, "id" | "lastScanned">[] = [];

    if (currentDepth > maxDepth) return repos;

    try {
      const entries = await readdir(basePath, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        // Skip hidden directories and common non-project dirs
        if (entry.name.startsWith(".")) continue;
        if (["node_modules", "vendor", ".git", "__pycache__", "dist", "build"].includes(entry.name)) continue;

        const fullPath = join(basePath, entry.name);
        const lowerName = entry.name.toLowerCase();
        const searchLower = this.searchTerm.toLowerCase();

        // Check if this directory matches our search term, or include all repos in container workspace dirs
        if (lowerName.includes(searchLower) || includeAllRepos) {
          // Check if it's a git repo
          if (await this.isGitRepo(fullPath)) {
            repos.push({
              path: fullPath,
              name: entry.name,
              isWsl,
            });
          }
        }

        // Continue scanning subdirectories
        const subRepos = await this.scanDirectory(fullPath, isWsl, maxDepth, currentDepth + 1, includeAllRepos);
        repos.push(...subRepos);
      }
    } catch (err) {
      // Permission denied or other errors - skip this directory
    }

    return repos;
  }

  /**
   * Scan all configured directories for matching repos
   */
  async scanForRepos(onProgress?: (message: string) => void): Promise<Omit<Repo, "id" | "lastScanned">[]> {
    const allRepos: Omit<Repo, "id" | "lastScanned">[] = [];
    const scanDirs = await this.getScanDirectories();

    for (const { path, isWsl, includeAllRepos } of scanDirs) {
      onProgress?.(`Scanning ${path}...`);
      try {
        const repos = await this.scanDirectory(path, isWsl, 4, 0, includeAllRepos);
        allRepos.push(...repos);
      } catch (err) {
        // Skip inaccessible directories
      }
    }

    // Remove duplicates (same path)
    const uniqueRepos = allRepos.filter(
      (repo, index, self) => index === self.findIndex((r) => r.path === repo.path)
    );

    return uniqueRepos;
  }

  /**
   * Check if path is a Windows path (mounted in WSL)
   */
  private isWindowsPath(path: string): boolean {
    return path.startsWith("/mnt/");
  }

  /**
   * Run a git command with timeout (longer timeout for Windows paths)
   */
  private async runGitCommand(args: string[], repoPath: string, timeoutMs?: number): Promise<string | null> {
    // Windows paths through WSL are much slower
    const defaultTimeout = this.isWindowsPath(repoPath) ? 120000 : 30000;
    const actualTimeout = timeoutMs ?? defaultTimeout;

    try {
      const proc = Bun.spawn(["git", ...args], {
        cwd: repoPath,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Create a timeout promise
      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => {
          proc.kill();
          resolve(null);
        }, actualTimeout);
      });

      // Race between the command and timeout
      const outputPromise = (async () => {
        const output = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;
        // Return null if command failed (non-zero exit code)
        if (exitCode !== 0) {
          return null;
        }
        return output;
      })();

      const result = await Promise.race([outputPromise, timeoutPromise]);
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Get the current branch of a repo
   */
  async getCurrentBranch(repoPath: string): Promise<string | null> {
    const output = await this.runGitCommand(["rev-parse", "--abbrev-ref", "HEAD"], repoPath);
    return output?.trim() || null;
  }

  /**
   * Get repo status (modified files count, etc.)
   */
  async getRepoStatus(repoPath: string): Promise<{ modified: number; staged: number; untracked: number } | null> {
    const output = await this.runGitCommand(["status", "--porcelain"], repoPath);
    if (output === null) return null;

    const lines = output.trim().split("\n").filter(Boolean);
    let modified = 0;
    let staged = 0;
    let untracked = 0;

    for (const line of lines) {
      const indexStatus = line[0];
      const workTreeStatus = line[1];

      if (indexStatus === "?" && workTreeStatus === "?") {
        untracked++;
      } else {
        if (indexStatus !== " " && indexStatus !== "?") {
          staged++;
        }
        if (workTreeStatus !== " " && workTreeStatus !== "?") {
          modified++;
        }
      }
    }

    return { modified, staged, untracked };
  }

  /**
   * Checkout a branch
   */
  async checkout(repoPath: string, branch: string): Promise<{ success: boolean; error?: string }> {
    const output = await this.runGitCommand(["checkout", branch], repoPath, 30000);
    if (output === null) {
      return { success: false, error: "Checkout timed out or failed" };
    }
    return { success: true };
  }

  /**
   * Fetch from remote
   */
  async fetch(repoPath: string): Promise<{ success: boolean; error?: string }> {
    const output = await this.runGitCommand(["fetch", "origin"], repoPath, 60000);
    if (output === null) {
      return { success: false, error: "Fetch timed out or failed" };
    }
    return { success: true };
  }

  /**
   * Pull latest changes
   */
  async pull(repoPath: string): Promise<{ success: boolean; error?: string }> {
    const output = await this.runGitCommand(["pull"], repoPath, 60000);
    if (output === null) {
      return { success: false, error: "Pull timed out or failed" };
    }
    return { success: true };
  }

  /**
   * Create and checkout a new branch
   */
  async createBranch(repoPath: string, branchName: string): Promise<{ success: boolean; error?: string }> {
    const output = await this.runGitCommand(["checkout", "-b", branchName], repoPath, 30000);
    if (output === null) {
      return { success: false, error: "Branch creation timed out or failed" };
    }
    return { success: true };
  }

  /**
   * Check if a branch exists locally
   */
  async branchExists(repoPath: string, branchName: string): Promise<boolean> {
    const output = await this.runGitCommand(["rev-parse", "--verify", branchName], repoPath);
    return output !== null && output.trim().length > 0;
  }

  /**
   * Checkout a ticket - creates a new branch from base
   */
  async checkoutTicket(
    repoPath: string,
    ticketKey: string,
    ticketTitle: string,
    baseBranch: string
  ): Promise<{ success: boolean; branchName?: string; error?: string }> {
    // Generate branch name from ticket
    // Remove hyphens (treat as space) and special chars, then collapse multiple spaces
    const sanitizedTitle = ticketTitle
      .toLowerCase()
      .replace(/-/g, " ")           // Treat hyphens as spaces
      .replace(/[^a-z0-9\s]/g, "")  // Remove special chars
      .replace(/\s+/g, "-")         // Replace one or more spaces with single hyphen
      .substring(0, 50)
      .replace(/-+$/, "");

    const branchName = `${ticketKey}-${sanitizedTitle}`;

    // Check if branch already exists
    if (await this.branchExists(repoPath, branchName)) {
      // Just checkout the existing branch
      const checkoutResult = await this.checkout(repoPath, branchName);
      if (!checkoutResult.success) {
        return { success: false, error: checkoutResult.error };
      }
      return { success: true, branchName };
    }

    // Fetch latest
    const fetchResult = await this.fetch(repoPath);
    if (!fetchResult.success) {
      return { success: false, error: `Failed to fetch: ${fetchResult.error}` };
    }

    // Checkout base branch
    const checkoutBaseResult = await this.checkout(repoPath, baseBranch);
    if (!checkoutBaseResult.success) {
      return { success: false, error: `Failed to checkout ${baseBranch}: ${checkoutBaseResult.error}` };
    }

    // Pull latest
    const pullResult = await this.pull(repoPath);
    if (!pullResult.success) {
      return { success: false, error: `Failed to pull ${baseBranch}: ${pullResult.error}` };
    }

    // Create new branch
    const createResult = await this.createBranch(repoPath, branchName);
    if (!createResult.success) {
      return { success: false, error: `Failed to create branch: ${createResult.error}` };
    }

    return { success: true, branchName };
  }

  /**
   * Checkout a base branch (fetch, checkout, pull)
   */
  async checkoutBaseBranch(
    repoPath: string,
    branchName: string
  ): Promise<{ success: boolean; error?: string }> {
    // Fetch latest
    const fetchResult = await this.fetch(repoPath);
    if (!fetchResult.success) {
      return { success: false, error: `Failed to fetch: ${fetchResult.error}` };
    }

    // Checkout the branch
    const checkoutResult = await this.checkout(repoPath, branchName);
    if (!checkoutResult.success) {
      return { success: false, error: `Failed to checkout ${branchName}: ${checkoutResult.error}` };
    }

    // Pull latest
    const pullResult = await this.pull(repoPath);
    if (!pullResult.success) {
      return { success: false, error: `Failed to pull ${branchName}: ${pullResult.error}` };
    }

    return { success: true };
  }

  /**
   * Checkout a PR branch
   */
  async checkoutPR(
    repoPath: string,
    branchName: string
  ): Promise<{ success: boolean; error?: string }> {
    // Fetch latest from all remotes
    const fetchResult = await this.fetch(repoPath);
    if (!fetchResult.success) {
      return { success: false, error: `Failed to fetch: ${fetchResult.error}` };
    }

    // Check if local branch already exists
    const localExists = await this.branchExists(repoPath, branchName);

    if (localExists) {
      // Checkout existing local branch
      const checkoutResult = await this.checkout(repoPath, branchName);
      if (!checkoutResult.success) {
        return { success: false, error: `Failed to checkout local branch ${branchName}` };
      }
      return { success: true };
    }

    // Check if remote branch exists
    const remoteExists = await this.runGitCommand(
      ["ls-remote", "--heads", "origin", branchName],
      repoPath,
      30000
    );

    if (!remoteExists || remoteExists.trim() === "") {
      return { success: false, error: `Branch ${branchName} not found locally or on remote` };
    }

    // Create local branch tracking the remote
    const output = await this.runGitCommand(
      ["checkout", "-b", branchName, "--track", `origin/${branchName}`],
      repoPath,
      30000
    );

    if (output === null) {
      return { success: false, error: `Failed to create tracking branch for ${branchName}` };
    }

    return { success: true };
  }

  /**
   * Get the upstream tracking branch for the current branch
   */
  async getUpstreamBranch(repoPath: string): Promise<string | null> {
    const output = await this.runGitCommand(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      repoPath
    );
    if (!output) return null;
    // Returns something like "origin/master" - we want just "master"
    const upstream = output.trim();
    if (upstream.startsWith("origin/")) {
      return upstream.replace("origin/", "");
    }
    return upstream;
  }

  /**
   * Get the parent/base branch that the current branch was likely created from.
   * Finds the closest base branch by checking merge-base distance.
   */
  async getParentBranch(repoPath: string, baseBranches: string[]): Promise<string | null> {
    if (baseBranches.length === 0) return null;

    // Get current branch
    const currentBranch = await this.getCurrentBranch(repoPath);
    if (!currentBranch) return null;

    // Don't find parent if we're on a base branch
    if (baseBranches.includes(currentBranch)) return null;

    let closestBranch: string | null = null;
    let closestDistance = Infinity;

    for (const baseBranch of baseBranches) {
      try {
        // Get merge-base between current and base branch
        const mergeBase = await this.runGitCommand(
          ["merge-base", "HEAD", `origin/${baseBranch}`],
          repoPath
        );
        if (!mergeBase) continue;

        // Count commits from merge-base to current branch
        const countOutput = await this.runGitCommand(
          ["rev-list", "--count", `${mergeBase.trim()}..HEAD`],
          repoPath
        );
        if (!countOutput) continue;

        const distance = parseInt(countOutput.trim(), 10);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestBranch = baseBranch;
        }
      } catch {
        // Skip branches we can't compare
      }
    }

    return closestBranch;
  }

  /**
   * Get the merge base (common ancestor) between current branch and target
   */
  async getMergeBase(repoPath: string, targetBranch: string): Promise<string | null> {
    const output = await this.runGitCommand(
      ["merge-base", "HEAD", `origin/${targetBranch}`],
      repoPath
    );
    return output?.trim() || null;
  }

  /**
   * Get list of changed files between current branch and target
   */
  async getChangedFiles(repoPath: string, targetBranch: string): Promise<{
    files: Array<{
      path: string;
      status: "added" | "modified" | "deleted" | "renamed";
      insertions: number;
      deletions: number;
    }>;
    totalInsertions: number;
    totalDeletions: number;
  } | null> {
    // Get diff stat
    const output = await this.runGitCommand(
      ["diff", "--numstat", `origin/${targetBranch}...HEAD`],
      repoPath,
      60000
    );
    if (output === null) return null;

    // Get file statuses
    const statusOutput = await this.runGitCommand(
      ["diff", "--name-status", `origin/${targetBranch}...HEAD`],
      repoPath,
      60000
    );
    if (statusOutput === null) return null;

    const statusMap = new Map<string, "added" | "modified" | "deleted" | "renamed">();
    for (const line of statusOutput.trim().split("\n").filter(Boolean)) {
      const [status, ...pathParts] = line.split("\t");
      const path = pathParts[pathParts.length - 1]; // Handle renamed files
      const statusChar = status[0];
      if (statusChar === "A") statusMap.set(path, "added");
      else if (statusChar === "D") statusMap.set(path, "deleted");
      else if (statusChar === "R") statusMap.set(path, "renamed");
      else statusMap.set(path, "modified");
    }

    const files: Array<{
      path: string;
      status: "added" | "modified" | "deleted" | "renamed";
      insertions: number;
      deletions: number;
    }> = [];

    let totalInsertions = 0;
    let totalDeletions = 0;

    for (const line of output.trim().split("\n").filter(Boolean)) {
      const [insertions, deletions, ...pathParts] = line.split("\t");
      const path = pathParts.join("\t"); // Handle paths with tabs
      const ins = insertions === "-" ? 0 : parseInt(insertions, 10);
      const del = deletions === "-" ? 0 : parseInt(deletions, 10);

      files.push({
        path,
        status: statusMap.get(path) || "modified",
        insertions: ins,
        deletions: del,
      });

      totalInsertions += ins;
      totalDeletions += del;
    }

    return { files, totalInsertions, totalDeletions };
  }

  /**
   * Get the full diff content between current branch and target
   */
  async getDiff(repoPath: string, targetBranch: string): Promise<string | null> {
    const output = await this.runGitCommand(
      ["diff", `origin/${targetBranch}...HEAD`],
      repoPath,
      120000 // 2 min timeout for large diffs
    );
    return output;
  }

  /**
   * Get diff for a specific file
   */
  async getFileDiff(repoPath: string, targetBranch: string, filePath: string): Promise<string | null> {
    const output = await this.runGitCommand(
      ["diff", `origin/${targetBranch}...HEAD`, "--", filePath],
      repoPath,
      60000
    );
    return output;
  }

  /**
   * Get commit list between current branch and target
   */
  async getCommits(repoPath: string, targetBranch: string): Promise<Array<{
    hash: string;
    shortHash: string;
    subject: string;
    author: string;
    date: string;
  }> | null> {
    const output = await this.runGitCommand(
      ["log", `origin/${targetBranch}..HEAD`, "--pretty=format:%H|%h|%s|%an|%ad", "--date=short"],
      repoPath,
      30000
    );
    if (output === null) return null;

    const commits: Array<{
      hash: string;
      shortHash: string;
      subject: string;
      author: string;
      date: string;
    }> = [];

    for (const line of output.trim().split("\n").filter(Boolean)) {
      const [hash, shortHash, subject, author, date] = line.split("|");
      commits.push({ hash, shortHash, subject, author, date });
    }

    return commits;
  }

  /**
   * Check if branch has been pushed to remote
   */
  async isBranchPushed(repoPath: string, branchName: string): Promise<boolean> {
    const output = await this.runGitCommand(
      ["ls-remote", "--heads", "origin", branchName],
      repoPath,
      30000
    );
    return output !== null && output.trim().length > 0;
  }

  /**
   * Push current branch to remote (with optional set-upstream)
   */
  async pushBranch(repoPath: string, branchName: string, setUpstream: boolean = true): Promise<{
    success: boolean;
    error?: string;
  }> {
    const args = setUpstream
      ? ["push", "-u", "origin", branchName]
      : ["push", "origin", branchName];

    const output = await this.runGitCommand(args, repoPath, 120000);
    if (output === null) {
      return { success: false, error: "Push timed out or failed" };
    }
    return { success: true };
  }

  /**
   * Get list of all remote branches
   */
  async getRemoteBranches(repoPath: string): Promise<string[]> {
    const output = await this.runGitCommand(
      ["branch", "-r", "--format=%(refname:short)"],
      repoPath
    );
    if (!output) return [];

    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((b) => b.replace("origin/", ""))
      .filter((b) => !b.includes("HEAD"));
  }

  /**
   * Get list of all local branches
   */
  async getLocalBranches(repoPath: string): Promise<string[]> {
    const output = await this.runGitCommand(
      ["branch", "--format=%(refname:short)"],
      repoPath
    );
    if (!output) return [];

    return output.trim().split("\n").filter(Boolean);
  }

  /**
   * Find a local branch that starts with the given ticket key
   */
  async findBranchForTicket(repoPath: string, ticketKey: string): Promise<string | null> {
    const branches = await this.getLocalBranches(repoPath);
    const ticketKeyUpper = ticketKey.toUpperCase();

    // Find branch that starts with ticket key (case-insensitive)
    const match = branches.find((b) => b.toUpperCase().startsWith(ticketKeyUpper));
    return match || null;
  }
}
