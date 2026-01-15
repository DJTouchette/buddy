import React, { useState, useEffect } from "react";
import { GitBranch, RefreshCw, Folder, Terminal, Check, ArrowRight, Loader2 } from "lucide-react";

interface StoredRepo {
  id: number;
  path: string;
  name: string;
  isWsl: boolean;
  lastScanned: number;
}

interface RepoStatus {
  modified: number;
  staged: number;
  untracked: number;
}

interface RepoData {
  repos: StoredRepo[];
  selectedRepo: StoredRepo | null;
}

interface BaseBranch {
  name: string;
  description: string | null;
}

export function GitPage() {
  const [repoData, setRepoData] = useState<RepoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState<{
    status: RepoStatus | null;
    branch: string | null;
  } | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [baseBranches, setBaseBranches] = useState<BaseBranch[]>([]);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Fetch repos from cache (fast)
  const fetchRepos = async () => {
    try {
      const response = await fetch("/api/repos");
      if (!response.ok) {
        throw new Error("Failed to fetch repos");
      }
      const data = await response.json();
      setRepoData(data);
      return data;
    } catch (err) {
      console.error("Failed to fetch repos:", err);
      setRepoData({ repos: [], selectedRepo: null });
      return null;
    } finally {
      setLoading(false);
    }
  };

  // Fetch base branches
  const fetchBaseBranches = async () => {
    try {
      const response = await fetch("/api/git/base-branches");
      if (response.ok) {
        const data = await response.json();
        setBaseBranches(data.branches || []);
      }
    } catch (err) {
      console.error("Failed to fetch base branches:", err);
    }
  };

  // Fetch git status (slow - runs in background)
  const fetchRepoStatus = async (repoId: number) => {
    setStatusLoading(true);
    try {
      const response = await fetch(`/api/repos/${repoId}/status`);
      if (!response.ok) {
        throw new Error("Failed to fetch status");
      }
      const data = await response.json();
      setSelectedStatus({ status: data.status || null, branch: data.branch || null });
    } catch (err) {
      console.error("Failed to fetch repo status:", err);
      setSelectedStatus({ status: null, branch: null });
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      const data = await fetchRepos();
      fetchBaseBranches();
      // Fetch status async after repos load (don't await)
      if (data?.selectedRepo) {
        fetchRepoStatus(data.selectedRepo.id);
      }
    };
    init();
  }, []);

  const handleScan = async () => {
    setScanning(true);
    setMessage(null);

    try {
      const response = await fetch("/api/repos/scan", { method: "POST" });
      const data = await response.json();

      if (response.ok) {
        setMessage({ type: "success", text: `Found ${data.count} repositories` });
        await fetchRepos();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to scan for repos" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Failed to scan for repos" });
    } finally {
      setScanning(false);
    }
  };

  const handleSelectRepo = async (repo: StoredRepo) => {
    // Update UI immediately
    setRepoData((prev) => prev ? { ...prev, selectedRepo: repo } : null);
    setSelectedStatus(null);

    try {
      const response = await fetch("/api/repos/selected", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: repo.id }),
      });

      if (response.ok) {
        // Fetch status in background (don't await)
        fetchRepoStatus(repo.id);
      }
    } catch (err) {
      console.error("Failed to select repo:", err);
    }
  };

  const handleCheckoutBase = async (branch: string) => {
    if (!repoData?.selectedRepo) {
      setMessage({ type: "error", text: "No repository selected" });
      return;
    }

    setCheckingOut(branch);
    setMessage(null);

    try {
      const response = await fetch("/api/git/checkout-base", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch }),
      });

      const data = await response.json();

      if (response.ok) {
        setMessage({ type: "success", text: `Checked out ${branch} and pulled latest` });
        // Refresh status
        fetchRepoStatus(repoData.selectedRepo.id);
      } else {
        setMessage({ type: "error", text: data.error || `Failed to checkout ${branch}` });
      }
    } catch (err) {
      setMessage({ type: "error", text: `Failed to checkout ${branch}` });
    } finally {
      setCheckingOut(null);
    }
  };

  const formatLastScanned = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-muted">
        Loading repositories...
      </div>
    );
  }

  const hasRepos = repoData?.repos && repoData.repos.length > 0;

  return (
    <div className="git-page">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GitBranch className="w-6 h-6" />
          Git Repositories
        </h1>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="btn-primary flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${scanning ? "animate-spin" : ""}`} />
          {scanning ? "Scanning..." : "Scan for Repos"}
        </button>
      </div>

      {message && (
        <div className={`settings-message ${message.type}`}>
          {message.text}
        </div>
      )}

      {scanning && (
        <div className="scan-progress">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Scanning directories... this might take a minute, WSL be slow sometimes</span>
        </div>
      )}

      {!hasRepos && !scanning ? (
        <div className="empty-state">
          <Folder className="w-12 h-12 text-muted mb-4" />
          <h2 className="text-xl font-semibold mb-2">No repositories found</h2>
          <p className="text-muted mb-4">
            Click "Scan for Repos" to search for git repositories containing "cassadol" in your home directory.
          </p>
        </div>
      ) : hasRepos ? (
        <div className="git-content">
          {/* Repo List */}
          <div className="settings-section">
            <h2 className="settings-section-title">
              <Folder className="w-5 h-5" />
              Available Repositories ({repoData.repos.length})
            </h2>

            <div className="repo-list">
              {repoData.repos.map((repo) => (
                <div
                  key={repo.id}
                  className={`repo-item ${repoData.selectedRepo?.id === repo.id ? "selected" : ""}`}
                  onClick={() => handleSelectRepo(repo)}
                >
                  <div className="repo-item-content">
                    <div className="repo-item-header">
                      <span className="repo-name">{repo.name}</span>
                      {repo.isWsl ? (
                        <span className="badge badge-wsl">WSL</span>
                      ) : (
                        <span className="badge badge-windows">Windows</span>
                      )}
                      {repoData.selectedRepo?.id === repo.id && (
                        <Check className="w-4 h-4 text-success ml-auto" />
                      )}
                    </div>
                    <span className="repo-path">{repo.path}</span>
                  </div>
                </div>
              ))}
            </div>

            {repoData.repos.length > 0 && (
              <p className="settings-hint mt-4">
                Last scanned: {formatLastScanned(repoData.repos[0].lastScanned)}
              </p>
            )}
          </div>

          {/* Selected Repo Status */}
          {repoData.selectedRepo && (
            <div className="settings-section">
              <h2 className="settings-section-title">
                <Terminal className="w-5 h-5" />
                Selected Repository
              </h2>

              <div className="settings-card">
                <div className="selected-repo-info">
                  <div className="selected-repo-header">
                    <h3 className="text-lg font-semibold">{repoData.selectedRepo.name}</h3>
                    {repoData.selectedRepo.isWsl ? (
                      <span className="badge badge-wsl">WSL</span>
                    ) : (
                      <span className="badge badge-windows">Windows</span>
                    )}
                  </div>
                  <p className="text-muted text-sm">{repoData.selectedRepo.path}</p>

                  {statusLoading ? (
                    <div className="repo-status-loading">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Fetching git status... this might take a sec
                    </div>
                  ) : selectedStatus ? (
                    <div className="repo-status">
                      {selectedStatus.branch && (
                        <div className="repo-status-item">
                          <GitBranch className="w-4 h-4" />
                          <span className="repo-status-label">Branch:</span>
                          <span className="repo-status-value">{selectedStatus.branch}</span>
                        </div>
                      )}
                      {selectedStatus.status && (
                        <div className="repo-status-changes">
                          {selectedStatus.status.staged > 0 && (
                            <span className="status-badge status-staged">
                              {selectedStatus.status.staged} staged
                            </span>
                          )}
                          {selectedStatus.status.modified > 0 && (
                            <span className="status-badge status-modified">
                              {selectedStatus.status.modified} modified
                            </span>
                          )}
                          {selectedStatus.status.untracked > 0 && (
                            <span className="status-badge status-untracked">
                              {selectedStatus.status.untracked} untracked
                            </span>
                          )}
                          {selectedStatus.status.staged === 0 &&
                            selectedStatus.status.modified === 0 &&
                            selectedStatus.status.untracked === 0 && (
                              <span className="status-badge status-clean">Clean</span>
                            )}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {/* Base Branches */}
          {repoData.selectedRepo && baseBranches.length > 0 && (
            <div className="settings-section">
              <h2 className="settings-section-title">
                <GitBranch className="w-5 h-5" />
                Quick Checkout
              </h2>

              <div className="settings-card">
                <div className="base-branches-list">
                  {baseBranches.map((branch) => (
                    <div key={branch.name} className="base-branch-item">
                      <div className="base-branch-info">
                        <span className="base-branch-name">{branch.name}</span>
                        {branch.description && (
                          <span className="base-branch-description">{branch.description}</span>
                        )}
                      </div>
                      <button
                        className="btn-sm btn-secondary"
                        onClick={() => handleCheckoutBase(branch.name)}
                        disabled={checkingOut !== null || selectedStatus?.branch === branch.name}
                      >
                        {checkingOut === branch.name ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Checking out...
                          </>
                        ) : selectedStatus?.branch === branch.name ? (
                          <>
                            <Check className="w-3 h-3" />
                            Current
                          </>
                        ) : (
                          <>
                            <ArrowRight className="w-3 h-3" />
                            Checkout
                          </>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
                <p className="settings-hint" style={{ marginTop: "0.75rem" }}>
                  Checkout will fetch, switch to the branch, and pull latest changes.
                </p>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
