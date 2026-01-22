import { Database } from "bun:sqlite";
import * as path from "path";
import * as os from "os";

export type JobType = "build" | "deploy" | "diff" | "synth" | "deploy-lambda" | "tail-logs" | "ai-fix";
export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "awaiting_approval";

export interface Job {
  id: string;
  type: JobType;
  target: string;
  status: JobStatus;
  progress: number;
  output: string[];
  startedAt: number;
  completedAt: number | null;
  error: string | null;
  awaitingApproval?: boolean;
  diffOutput?: string[]; // The diff portion for parsing/display
  tmuxSession?: string; // tmux session name for attaching
}

export interface CreateJobOptions {
  type: JobType;
  target: string;
}

interface JobRow {
  id: string;
  type: string;
  target: string;
  status: string;
  progress: number;
  output: string;
  started_at: number;
  completed_at: number | null;
  error: string | null;
  tmux_session: string | null;
}

export class JobService {
  private db: Database;
  private outputListeners: Map<string, ((line: string) => void)[]> = new Map();
  private runningProcesses: Map<string, { kill: () => void }> = new Map();
  private stdinWriters: Map<string, (data: string) => void> = new Map();
  private approvalListeners: Map<string, ((approved: boolean) => void)[]> = new Map();

  constructor() {
    const dbPath = path.join(os.homedir(), ".buddy", "jobs.db");

    // Ensure directory exists
    const dir = path.dirname(dbPath);
    try {
      Bun.spawnSync(["mkdir", "-p", dir]);
    } catch {}

    this.db = new Database(dbPath);
    this.initDatabase();
  }

  private initDatabase() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        target TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        progress INTEGER DEFAULT 0,
        output TEXT DEFAULT '[]',
        started_at INTEGER,
        completed_at INTEGER,
        error TEXT,
        tmux_session TEXT
      )
    `);

    // Migration: add tmux_session column if it doesn't exist
    try {
      this.db.run(`ALTER TABLE jobs ADD COLUMN tmux_session TEXT`);
    } catch {
      // Column already exists
    }

    this.db.run(`
      CREATE TABLE IF NOT EXISTS lambda_builds (
        name TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        last_built_at INTEGER,
        last_build_status TEXT,
        deployment_zip_exists INTEGER DEFAULT 0
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS saved_logs (
        id TEXT PRIMARY KEY,
        lambda_name TEXT NOT NULL,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    // Create index for faster queries
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_saved_logs_lambda ON saved_logs(lambda_name)
    `);

    // Clean up old completed jobs (keep last 50)
    this.cleanupOldJobs();
  }

  private cleanupOldJobs() {
    this.db.run(`
      DELETE FROM jobs
      WHERE id NOT IN (
        SELECT id FROM jobs
        ORDER BY started_at DESC
        LIMIT 50
      )
    `);
  }

  /**
   * Create a new job
   */
  createJob(options: CreateJobOptions): Job {
    const id = crypto.randomUUID();
    const now = Date.now();

    this.db.run(
      `INSERT INTO jobs (id, type, target, status, progress, output, started_at)
       VALUES (?, ?, ?, 'pending', 0, '[]', ?)`,
      [id, options.type, options.target, now]
    );

    return {
      id,
      type: options.type,
      target: options.target,
      status: "pending",
      progress: 0,
      output: [],
      startedAt: now,
      completedAt: null,
      error: null,
    };
  }

  /**
   * Get a job by ID
   */
  getJob(id: string): Job | null {
    const row = this.db.query<JobRow, [string]>(
      "SELECT * FROM jobs WHERE id = ?"
    ).get(id);

    if (!row) return null;

    return this.rowToJob(row);
  }

  /**
   * Get all active (pending/running/awaiting_approval) jobs
   */
  getActiveJobs(): Job[] {
    const rows = this.db.query<JobRow, []>(
      "SELECT * FROM jobs WHERE status IN ('pending', 'running', 'awaiting_approval') ORDER BY started_at DESC"
    ).all();

    return rows.map((row) => this.rowToJob(row));
  }

  /**
   * Get recent jobs (including completed)
   */
  getRecentJobs(limit: number = 20): Job[] {
    const rows = this.db.query<JobRow, [number]>(
      "SELECT * FROM jobs ORDER BY started_at DESC LIMIT ?"
    ).all(limit);

    return rows.map((row) => this.rowToJob(row));
  }

  /**
   * Update job status
   */
  updateJobStatus(id: string, status: JobStatus, error?: string) {
    const updates: string[] = ["status = ?"];
    const params: (string | number | null)[] = [status];

    if (status === "running") {
      // No additional updates needed
    } else if (status === "completed" || status === "failed" || status === "cancelled") {
      updates.push("completed_at = ?");
      params.push(Date.now());
    }

    if (error) {
      updates.push("error = ?");
      params.push(error);
    }

    params.push(id);

    this.db.run(
      `UPDATE jobs SET ${updates.join(", ")} WHERE id = ?`,
      params
    );
  }

  /**
   * Update job progress (0-100)
   */
  updateJobProgress(id: string, progress: number) {
    this.db.run(
      "UPDATE jobs SET progress = ? WHERE id = ?",
      [Math.min(100, Math.max(0, progress)), id]
    );
  }

  /**
   * Append output line to job
   */
  appendOutput(id: string, line: string) {
    // Get current output
    const job = this.getJob(id);
    if (!job) return;

    const output = [...job.output, line];

    // Keep only last 1000 lines in DB
    const trimmedOutput = output.slice(-1000);

    this.db.run(
      "UPDATE jobs SET output = ? WHERE id = ?",
      [JSON.stringify(trimmedOutput), id]
    );

    // Notify listeners
    const listeners = this.outputListeners.get(id) || [];
    for (const listener of listeners) {
      listener(line);
    }
  }

  /**
   * Subscribe to job output
   */
  subscribeToOutput(id: string, listener: (line: string) => void): () => void {
    if (!this.outputListeners.has(id)) {
      this.outputListeners.set(id, []);
    }
    this.outputListeners.get(id)!.push(listener);

    // Return unsubscribe function
    return () => {
      const listeners = this.outputListeners.get(id);
      if (listeners) {
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    };
  }

  /**
   * Register a process for a job (so it can be cancelled)
   */
  registerProcess(id: string, process: { kill: () => void }) {
    this.runningProcesses.set(id, process);
  }

  /**
   * Unregister a process
   */
  unregisterProcess(id: string) {
    this.runningProcesses.delete(id);
  }

  /**
   * Set tmux session name for a job
   */
  setTmuxSession(id: string, sessionName: string) {
    this.db.run(
      "UPDATE jobs SET tmux_session = ? WHERE id = ?",
      [sessionName, id]
    );
  }

  /**
   * Clear tmux session name for a job
   */
  clearTmuxSession(id: string) {
    this.db.run(
      "UPDATE jobs SET tmux_session = NULL WHERE id = ?",
      [id]
    );
  }

  /**
   * Cancel a running job
   */
  cancelJob(id: string): boolean {
    const job = this.getJob(id);
    if (!job || (job.status !== "running" && job.status !== "awaiting_approval")) {
      return false;
    }

    // Kill the process if registered
    const process = this.runningProcesses.get(id);
    if (process) {
      try {
        process.kill();
      } catch {}
      this.unregisterProcess(id);
    }

    this.updateJobStatus(id, "cancelled");
    this.appendOutput(id, "\n[Job cancelled by user]");

    // Clear diff cache if it was awaiting approval
    this._diffOutputCache.delete(id);

    return true;
  }

  /**
   * Force kill all running jobs and processes
   */
  forceKillAll(): void {
    // Kill all registered processes
    for (const [id, process] of this.runningProcesses) {
      try {
        process.kill();
      } catch {}
    }
    this.runningProcesses.clear();

    // Mark all running/pending jobs as cancelled
    const activeJobs = this.getActiveJobs();
    for (const job of activeJobs) {
      this.updateJobStatus(job.id, "cancelled");
      this.appendOutput(job.id, "\n[Job force-killed]");
    }

    // Clear all listeners and stdin writers
    this.outputListeners.clear();
    this.stdinWriters.clear();
    this.approvalListeners.clear();
  }

  /**
   * Register a stdin writer for interactive processes
   */
  registerStdinWriter(id: string, writer: (data: string) => void) {
    this.stdinWriters.set(id, writer);
  }

  /**
   * Unregister stdin writer
   */
  unregisterStdinWriter(id: string) {
    this.stdinWriters.delete(id);
  }

  /**
   * Set job as awaiting approval and store the diff output
   */
  setAwaitingApproval(id: string, diffOutput: string[]) {
    this.db.run(
      "UPDATE jobs SET status = 'awaiting_approval' WHERE id = ?",
      [id]
    );

    // Store diff output in memory (not persisted to DB to avoid bloat)
    // We'll fetch it via getJob which will include it
    const job = this.getJob(id);
    if (job) {
      // Notify listeners about the status change
      const listeners = this.approvalListeners.get(id) || [];
      // Store diff in a temporary map
      this._diffOutputCache.set(id, diffOutput);
    }
  }

  private _diffOutputCache: Map<string, string[]> = new Map();

  /**
   * Get diff output for a job awaiting approval
   */
  getDiffOutput(id: string): string[] | null {
    return this._diffOutputCache.get(id) || null;
  }

  /**
   * Send approval response to waiting job
   */
  sendApprovalResponse(id: string, approved: boolean): boolean {
    const job = this.getJob(id);
    if (!job || job.status !== "awaiting_approval") {
      return false;
    }

    // Update status back to running if approved, cancelled if rejected
    if (approved) {
      this.updateJobStatus(id, "running");
      this.appendOutput(id, "\n✓ Deploy approved by user\n");
    } else {
      this.appendOutput(id, "\n✗ Deploy rejected by user");
      this.updateJobStatus(id, "cancelled");
    }

    // Clear the diff cache
    this._diffOutputCache.delete(id);

    return true;
  }

  /**
   * Subscribe to approval status changes
   */
  subscribeToApproval(id: string, listener: (approved: boolean) => void): () => void {
    if (!this.approvalListeners.has(id)) {
      this.approvalListeners.set(id, []);
    }
    this.approvalListeners.get(id)!.push(listener);

    return () => {
      const listeners = this.approvalListeners.get(id);
      if (listeners) {
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    };
  }

  /**
   * Update lambda build status
   */
  updateLambdaBuild(
    name: string,
    type: string,
    status: "success" | "failed",
    deploymentZipExists: boolean
  ) {
    this.db.run(
      `INSERT INTO lambda_builds (name, type, last_built_at, last_build_status, deployment_zip_exists)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         last_built_at = excluded.last_built_at,
         last_build_status = excluded.last_build_status,
         deployment_zip_exists = excluded.deployment_zip_exists`,
      [name, type, Date.now(), status, deploymentZipExists ? 1 : 0]
    );
  }

  /**
   * Get lambda build info
   */
  getLambdaBuildInfo(name: string): {
    lastBuiltAt: number | null;
    lastBuildStatus: string | null;
    deploymentZipExists: boolean;
  } | null {
    const row = this.db.query<{
      last_built_at: number | null;
      last_build_status: string | null;
      deployment_zip_exists: number;
    }, [string]>(
      "SELECT last_built_at, last_build_status, deployment_zip_exists FROM lambda_builds WHERE name = ?"
    ).get(name);

    if (!row) return null;

    return {
      lastBuiltAt: row.last_built_at,
      lastBuildStatus: row.last_build_status,
      deploymentZipExists: row.deployment_zip_exists === 1,
    };
  }

  /**
   * Get all lambda build info
   */
  getAllLambdaBuildInfo(): Map<string, {
    lastBuiltAt: number | null;
    lastBuildStatus: string | null;
    deploymentZipExists: boolean;
  }> {
    const rows = this.db.query<{
      name: string;
      last_built_at: number | null;
      last_build_status: string | null;
      deployment_zip_exists: number;
    }, []>(
      "SELECT name, last_built_at, last_build_status, deployment_zip_exists FROM lambda_builds"
    ).all();

    const map = new Map();
    for (const row of rows) {
      map.set(row.name, {
        lastBuiltAt: row.last_built_at,
        lastBuildStatus: row.last_build_status,
        deploymentZipExists: row.deployment_zip_exists === 1,
      });
    }

    return map;
  }

  private rowToJob(row: JobRow): Job {
    const job: Job = {
      id: row.id,
      type: row.type as JobType,
      target: row.target,
      status: row.status as JobStatus,
      progress: row.progress,
      output: JSON.parse(row.output),
      startedAt: row.started_at,
      completedAt: row.completed_at,
      error: row.error,
    };

    // Add approval-related fields if applicable
    if (job.status === "awaiting_approval") {
      job.awaitingApproval = true;
      const diffOutput = this._diffOutputCache.get(row.id);
      if (diffOutput) {
        job.diffOutput = diffOutput;
      }
    }

    return job;
  }

  /**
   * Save a log for a lambda
   */
  saveLog(lambdaName: string, name: string, content: string): SavedLog {
    const id = crypto.randomUUID();
    const createdAt = Date.now();

    this.db.run(
      `INSERT INTO saved_logs (id, lambda_name, name, content, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, lambdaName, name, content, createdAt]
    );

    return { id, lambdaName, name, content, createdAt };
  }

  /**
   * Get saved logs for a lambda (newest first)
   */
  getSavedLogs(lambdaName: string): SavedLog[] {
    const rows = this.db.query<SavedLogRow, [string]>(
      "SELECT * FROM saved_logs WHERE lambda_name = ? ORDER BY created_at DESC"
    ).all(lambdaName);

    return rows.map((row) => ({
      id: row.id,
      lambdaName: row.lambda_name,
      name: row.name,
      content: row.content,
      createdAt: row.created_at,
    }));
  }

  /**
   * Get a single saved log by ID
   */
  getSavedLog(id: string): SavedLog | null {
    const row = this.db.query<SavedLogRow, [string]>(
      "SELECT * FROM saved_logs WHERE id = ?"
    ).get(id);

    if (!row) return null;

    return {
      id: row.id,
      lambdaName: row.lambda_name,
      name: row.name,
      content: row.content,
      createdAt: row.created_at,
    };
  }

  /**
   * Delete a saved log
   */
  deleteSavedLog(id: string): boolean {
    const result = this.db.run("DELETE FROM saved_logs WHERE id = ?", [id]);
    return result.changes > 0;
  }
}

export interface SavedLog {
  id: string;
  lambdaName: string;
  name: string;
  content: string;
  createdAt: number;
}

interface SavedLogRow {
  id: string;
  lambda_name: string;
  name: string;
  content: string;
  created_at: number;
}
