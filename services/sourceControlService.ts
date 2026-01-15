import { $ } from "bun";
import { execSync } from "child_process";

export interface SourceControlServiceOptions {
  cwd?: string;
}

export class SourceControlService {
  private cwd: string;

  constructor(options: SourceControlServiceOptions = {}) {
    this.cwd = options.cwd || process.cwd();
  }

  static async create(options: SourceControlServiceOptions = {}): Promise<SourceControlService> {
    const initialCwd = options.cwd || process.cwd();

    // Use child_process instead of Bun's $ for better compatibility in compiled executables
    try {
      const root = execSync('git rev-parse --show-toplevel', {
        cwd: initialCwd,
        encoding: 'utf8',
        timeout: 5000, // 5 second timeout
      }).trim();
      return new SourceControlService({ cwd: root });
    } catch (error) {
      throw new Error(`Not a git repository or git not available: ${error}`);
    }
  }

  async getRoot(): Promise<string> {
    return this.cwd;
  }

  async getCurrentBranch(): Promise<string> {
    const result = execSync('git branch --show-current', {
      cwd: this.cwd,
      encoding: 'utf8',
    });
    return result.trim();
  }

  async checkout(branchName: string): Promise<void> {
    execSync(`git checkout ${branchName}`, { cwd: this.cwd });
    console.log(`✓ Checked out branch: ${branchName}`);
  }

  async createBranch(branchName: string, checkout: boolean = true): Promise<void> {
    if (checkout) {
      execSync(`git checkout -b ${branchName}`, { cwd: this.cwd });
      console.log(`✓ Created and checked out branch: ${branchName}`);
    } else {
      execSync(`git branch ${branchName}`, { cwd: this.cwd });
      console.log(`✓ Created branch: ${branchName}`);
    }
  }

  async addFiles(files: string[] = ["."]): Promise<void> {
    const fileArgs = files.join(" ");
    execSync(`git add ${fileArgs}`, { cwd: this.cwd });
    console.log(`✓ Added files: ${fileArgs}`);
  }

  async commit(message: string): Promise<void> {
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: this.cwd });
    console.log(`✓ Committed: ${message}`);
  }

  async pull(): Promise<void> {
    execSync('git pull', { cwd: this.cwd });
    console.log(`✓ Pulled latest changes`);
  }

  async push(setBranch: boolean = true): Promise<void> {
    const currentBranch = await this.getCurrentBranch();

    if (setBranch) {
      execSync(`git push -u origin ${currentBranch}`, { cwd: this.cwd });
      console.log(`✓ Pushed and set upstream: origin/${currentBranch}`);
    } else {
      execSync('git push', { cwd: this.cwd });
      console.log(`✓ Pushed to remote`);
    }
  }

  async getStatus(): Promise<string> {
    const result = execSync('git status --short', {
      cwd: this.cwd,
      encoding: 'utf8',
    });
    return result;
  }

  async branchExists(branchName: string): Promise<boolean> {
    try {
      execSync(`git rev-parse --verify ${branchName}`, {
        cwd: this.cwd,
        stdio: 'ignore',
      });
      return true;
    } catch {
      return false;
    }
  }
}
