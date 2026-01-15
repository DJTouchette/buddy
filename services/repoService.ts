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
   * Get directories to scan based on platform
   */
  private getScanDirectories(): { path: string; isWsl: boolean }[] {
    const dirs: { path: string; isWsl: boolean }[] = [];

    // WSL home directory
    const home = homedir();
    dirs.push({ path: home, isWsl: true });

    // Windows user directories (common mount points in WSL)
    const windowsMounts = ["/mnt/c/Users", "/mnt/d/Users"];
    for (const mount of windowsMounts) {
      dirs.push({ path: mount, isWsl: false });
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
    currentDepth: number = 0
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

        // Check if this directory matches our search term
        if (lowerName.includes(searchLower)) {
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
        const subRepos = await this.scanDirectory(fullPath, isWsl, maxDepth, currentDepth + 1);
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
    const scanDirs = this.getScanDirectories();

    for (const { path, isWsl } of scanDirs) {
      onProgress?.(`Scanning ${path}...`);
      try {
        const repos = await this.scanDirectory(path, isWsl);
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
    const sanitizedTitle = ticketTitle
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
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
}
