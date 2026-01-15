import { Database } from "bun:sqlite";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync, existsSync } from "fs";

export interface CacheSettings {
  pollIntervalMinutes: number;
}

export interface StoredRepo {
  id: number;
  path: string;
  name: string;
  isWsl: boolean;
  lastScanned: number;
}

export interface CachedData<T> {
  data: T;
  cachedAt: number;
  expiresAt: number;
}

const DEFAULT_SETTINGS: CacheSettings = {
  pollIntervalMinutes: 5,
};

export class CacheService {
  private db: Database;
  private dbPath: string;

  constructor() {
    // Store in ~/.buddy/cache.db
    const buddyDir = join(homedir(), ".buddy");
    if (!existsSync(buddyDir)) {
      mkdirSync(buddyDir, { recursive: true });
    }

    this.dbPath = join(buddyDir, "cache.db");
    this.db = new Database(this.dbPath);

    this.initializeSchema();
  }

  private initializeSchema() {
    // Create tables if they don't exist
    this.db.run(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        cached_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS repos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        is_wsl INTEGER NOT NULL,
        last_scanned INTEGER NOT NULL
      )
    `);

    // Initialize default settings if not exists
    const existingSettings = this.db.query("SELECT key FROM settings WHERE key = 'pollIntervalMinutes'").get();
    if (!existingSettings) {
      this.db.run(
        "INSERT INTO settings (key, value) VALUES (?, ?)",
        ["pollIntervalMinutes", String(DEFAULT_SETTINGS.pollIntervalMinutes)]
      );
    }
  }

  // Cache operations
  get<T>(key: string): CachedData<T> | null {
    const row = this.db.query<{ data: string; cached_at: number; expires_at: number }, [string]>(
      "SELECT data, cached_at, expires_at FROM cache WHERE key = ?"
    ).get(key);

    if (!row) return null;

    return {
      data: JSON.parse(row.data) as T,
      cachedAt: row.cached_at,
      expiresAt: row.expires_at,
    };
  }

  set<T>(key: string, data: T, ttlMinutes?: number): void {
    const now = Date.now();
    const ttl = ttlMinutes ?? this.getSettings().pollIntervalMinutes;
    const expiresAt = now + ttl * 60 * 1000;

    this.db.run(
      `INSERT OR REPLACE INTO cache (key, data, cached_at, expires_at) VALUES (?, ?, ?, ?)`,
      [key, JSON.stringify(data), now, expiresAt]
    );
  }

  isExpired(key: string): boolean {
    const cached = this.get(key);
    if (!cached) return true;
    return Date.now() > cached.expiresAt;
  }

  invalidate(key: string): void {
    this.db.run("DELETE FROM cache WHERE key = ?", [key]);
  }

  invalidateAll(): void {
    this.db.run("DELETE FROM cache");
  }

  getCacheInfo(key: string): { cachedAt: Date; expiresAt: Date; isExpired: boolean } | null {
    const cached = this.get(key);
    if (!cached) return null;

    return {
      cachedAt: new Date(cached.cachedAt),
      expiresAt: new Date(cached.expiresAt),
      isExpired: Date.now() > cached.expiresAt,
    };
  }

  // Settings operations
  getSettings(): CacheSettings {
    const pollInterval = this.db.query<{ value: string }, [string]>(
      "SELECT value FROM settings WHERE key = ?"
    ).get("pollIntervalMinutes");

    return {
      pollIntervalMinutes: pollInterval ? parseInt(pollInterval.value) : DEFAULT_SETTINGS.pollIntervalMinutes,
    };
  }

  updateSettings(settings: Partial<CacheSettings>): CacheSettings {
    if (settings.pollIntervalMinutes !== undefined) {
      this.db.run(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        ["pollIntervalMinutes", String(settings.pollIntervalMinutes)]
      );
    }

    return this.getSettings();
  }

  // Get last update time for display
  getLastUpdateTime(): Date | null {
    const row = this.db.query<{ cached_at: number }, []>(
      "SELECT MAX(cached_at) as cached_at FROM cache"
    ).get();

    if (!row || !row.cached_at) return null;
    return new Date(row.cached_at);
  }

  // Repo operations
  saveRepos(repos: Omit<StoredRepo, "id">[]): void {
    const now = Date.now();
    const stmt = this.db.prepare(
      "INSERT OR REPLACE INTO repos (path, name, is_wsl, last_scanned) VALUES (?, ?, ?, ?)"
    );

    for (const repo of repos) {
      stmt.run(repo.path, repo.name, repo.isWsl ? 1 : 0, now);
    }
  }

  getRepos(): StoredRepo[] {
    const rows = this.db.query<{ id: number; path: string; name: string; is_wsl: number; last_scanned: number }, []>(
      "SELECT id, path, name, is_wsl, last_scanned FROM repos ORDER BY name"
    ).all();

    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      name: row.name,
      isWsl: row.is_wsl === 1,
      lastScanned: row.last_scanned,
    }));
  }

  clearRepos(): void {
    this.db.run("DELETE FROM repos");
  }

  getSelectedRepoId(): number | null {
    const row = this.db.query<{ value: string }, [string]>(
      "SELECT value FROM settings WHERE key = ?"
    ).get("selectedRepoId");

    return row ? parseInt(row.value) : null;
  }

  setSelectedRepoId(repoId: number | null): void {
    if (repoId === null) {
      this.db.run("DELETE FROM settings WHERE key = ?", ["selectedRepoId"]);
    } else {
      this.db.run(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        ["selectedRepoId", String(repoId)]
      );
    }
  }

  getSelectedRepo(): StoredRepo | null {
    const repoId = this.getSelectedRepoId();
    if (!repoId) return null;

    const row = this.db.query<{ id: number; path: string; name: string; is_wsl: number; last_scanned: number }, [number]>(
      "SELECT id, path, name, is_wsl, last_scanned FROM repos WHERE id = ?"
    ).get(repoId);

    if (!row) return null;

    return {
      id: row.id,
      path: row.path,
      name: row.name,
      isWsl: row.is_wsl === 1,
      lastScanned: row.last_scanned,
    };
  }

  // Infrastructure config operations
  getCurrentEnvironment(): string | null {
    const row = this.db.query<{ value: string }, [string]>(
      "SELECT value FROM settings WHERE key = ?"
    ).get("currentEnvironment");

    return row?.value || null;
  }

  setCurrentEnvironment(env: string | null): void {
    if (env === null) {
      this.db.run("DELETE FROM settings WHERE key = ?", ["currentEnvironment"]);
    } else {
      this.db.run(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
        ["currentEnvironment", env]
      );
    }
  }

  getInfraStage(): "dev" | "prod" | "staging" | "int" | "demo" {
    const row = this.db.query<{ value: string }, [string]>(
      "SELECT value FROM settings WHERE key = ?"
    ).get("infraStage");

    return (row?.value as "dev" | "prod" | "staging" | "int" | "demo") || "dev";
  }

  setInfraStage(stage: "dev" | "prod" | "staging" | "int" | "demo"): void {
    this.db.run(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
      ["infraStage", stage]
    );
  }

  close(): void {
    this.db.close();
  }
}
