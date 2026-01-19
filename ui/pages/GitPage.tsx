import React, { useState, useEffect, useMemo } from "react";
import { GitBranch, RefreshCw, Folder, Terminal, Check, ArrowRight, Loader2, Upload, Code, GitMerge, Plus, Minus, FileText, ChevronDown, ChevronRight, FileDiff } from "lucide-react";
import { DiffView, DiffModeEnum } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view.css";

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

interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  insertions: number;
  deletions: number;
}

interface BranchInfo {
  currentBranch: string;
  isPushed: boolean;
  parentBranch: string | null;
  changedFiles: {
    files: FileChange[];
    totalInsertions: number;
    totalDeletions: number;
  } | null;
}

type MainTab = "repos" | "branch";

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

  // Tab state
  const [mainTab, setMainTab] = useState<MainTab>("repos");

  // Branch tab state
  const [branchInfo, setBranchInfo] = useState<BranchInfo | null>(null);
  const [branchInfoLoading, setBranchInfoLoading] = useState(false);
  const [targetBranch, setTargetBranch] = useState<string>("");
  const [isPushing, setIsPushing] = useState(false);

  // Diff state
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [diffMode, setDiffMode] = useState<"split" | "unified">("split");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Dark mode detection
  const [isDarkMode, setIsDarkMode] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

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

  // Fetch branch info for the current branch
  const fetchBranchInfo = async (target?: string) => {
    setBranchInfoLoading(true);
    try {
      const url = target
        ? `/api/git/pr-info?target=${encodeURIComponent(target)}`
        : "/api/git/pr-info";
      const response = await fetch(url);
      const data = await response.json();

      if (response.ok) {
        setBranchInfo({
          currentBranch: data.currentBranch,
          isPushed: data.isPushed,
          parentBranch: data.parentBranch,
          changedFiles: data.changedFiles,
        });

        // Set default target branch if not set
        if (!targetBranch && data.parentBranch) {
          setTargetBranch(data.parentBranch);
        } else if (!targetBranch && data.baseBranches?.length > 0) {
          setTargetBranch(data.baseBranches[0]);
        }
      }
    } catch (err) {
      console.error("Failed to fetch branch info:", err);
    } finally {
      setBranchInfoLoading(false);
    }
  };

  // Fetch diff content
  const fetchDiff = async (target: string, file?: string) => {
    setLoadingDiff(true);
    try {
      const url = file
        ? `/api/git/diff?target=${encodeURIComponent(target)}&file=${encodeURIComponent(file)}`
        : `/api/git/diff?target=${encodeURIComponent(target)}`;
      const response = await fetch(url);
      const data = await response.json();

      if (response.ok && data.diff) {
        setDiffContent(data.diff);
      } else {
        setDiffContent(null);
      }
    } catch {
      setDiffContent(null);
    } finally {
      setLoadingDiff(false);
    }
  };

  // Push branch to remote
  const handlePush = async () => {
    setIsPushing(true);
    setMessage(null);
    try {
      const response = await fetch("/api/git/push", { method: "POST" });
      const data = await response.json();

      if (response.ok) {
        setMessage({ type: "success", text: `Pushed ${branchInfo?.currentBranch} to origin` });
        // Refresh branch info
        fetchBranchInfo(targetBranch);
      } else {
        setMessage({ type: "error", text: data.error || "Push failed" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Push failed" });
    } finally {
      setIsPushing(false);
    }
  };

  // Parse diff content into individual file diffs
  const parsedDiffs = useMemo(() => {
    if (!diffContent) return [];

    const fileDiffs: Array<{ fileName: string; diffString: string }> = [];
    const sections = diffContent.split(/(?=^diff --git )/m);

    for (const section of sections) {
      if (!section.trim()) continue;

      const headerMatch = section.match(/^diff --git a\/(.+) b\/(.+)/m);
      const fileName = headerMatch?.[2] ?? "file";

      const diffStartMatch = section.match(/^(---[\s\S]*)/m);
      if (diffStartMatch?.[1]) {
        fileDiffs.push({
          fileName,
          diffString: diffStartMatch[1],
        });
      }
    }

    return fileDiffs;
  }, [diffContent]);

  // Group files by directory
  const groupedFiles = useMemo(() => {
    if (!branchInfo?.changedFiles?.files) return new Map<string, FileChange[]>();

    const groups = new Map<string, FileChange[]>();

    for (const file of branchInfo.changedFiles.files) {
      const parts = file.path.split("/");
      const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";

      if (!groups.has(dir)) {
        groups.set(dir, []);
      }
      groups.get(dir)!.push(file);
    }

    return groups;
  }, [branchInfo?.changedFiles?.files]);

  const toggleDir = (dir: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) {
        next.delete(dir);
      } else {
        next.add(dir);
      }
      return next;
    });
  };

  // Auto-expand all directories when files change
  useEffect(() => {
    if (groupedFiles.size > 0 && expandedDirs.size === 0) {
      setExpandedDirs(new Set(groupedFiles.keys()));
    }
  }, [groupedFiles]);

  // Map file extensions to language identifiers
  const getFileLang = (fileName: string): string => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
      'ts': 'typescript', 'tsx': 'tsx', 'js': 'javascript', 'jsx': 'jsx',
      'json': 'json', 'md': 'markdown', 'css': 'css', 'scss': 'scss',
      'html': 'xml', 'xml': 'xml', 'yaml': 'yaml', 'yml': 'yaml',
      'py': 'python', 'go': 'go', 'rs': 'rust', 'java': 'java',
      'cs': 'csharp', 'cpp': 'cpp', 'c': 'c', 'sh': 'bash', 'sql': 'sql',
    };
    return langMap[ext] || 'plaintext';
  };

  // File status helpers
  const FileStatusIcon = ({ status }: { status: FileChange["status"] }) => {
    switch (status) {
      case "added": return <Plus className="w-4 h-4 text-green-500" />;
      case "deleted": return <Minus className="w-4 h-4 text-red-500" />;
      case "renamed": return <GitBranch className="w-4 h-4 text-blue-500" />;
      default: return <FileDiff className="w-4 h-4 text-yellow-500" />;
    }
  };

  const FileStatusBadge = ({ status }: { status: FileChange["status"] }) => {
    const classes: Record<FileChange["status"], string> = {
      added: "badge-green", deleted: "badge-red", modified: "badge-yellow", renamed: "badge-blue",
    };
    return <span className={`badge badge-sm ${classes[status]}`}>{status}</span>;
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-muted">
        Loading repositories...
      </div>
    );
  }

  const hasRepos = repoData?.repos && repoData.repos.length > 0;
  const isBaseBranch = branchInfo && baseBranches.some(b => b.name === branchInfo.currentBranch);

  return (
    <div className="git-page">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <GitBranch className="w-6 h-6" />
          Git
        </h1>
        {mainTab === "repos" && (
          <button
            onClick={handleScan}
            disabled={scanning}
            className="btn-primary flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? "Scanning..." : "Scan for Repos"}
          </button>
        )}
      </div>

      {/* Main Tabs */}
      <div className="main-tabs mb-6">
        <button
          className={`main-tab ${mainTab === "repos" ? "active" : ""}`}
          onClick={() => setMainTab("repos")}
        >
          <Folder className="w-4 h-4" />
          Repositories
        </button>
        <button
          className={`main-tab ${mainTab === "branch" ? "active" : ""}`}
          onClick={() => {
            setMainTab("branch");
            if (!branchInfo && repoData?.selectedRepo) {
              fetchBranchInfo();
            }
          }}
          disabled={!repoData?.selectedRepo}
        >
          <Code className="w-4 h-4" />
          Current Branch
        </button>
      </div>

      {message && (
        <div className={`settings-message ${message.type}`}>
          {message.text}
        </div>
      )}

      {scanning && mainTab === "repos" && (
        <div className="scan-progress">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>Scanning directories... this might take a minute, WSL be slow sometimes</span>
        </div>
      )}

      {/* Repos Tab */}
      {mainTab === "repos" && !hasRepos && !scanning ? (
        <div className="empty-state">
          <Folder className="w-12 h-12 text-muted mb-4" />
          <h2 className="text-xl font-semibold mb-2">No repositories found</h2>
          <p className="text-muted mb-4">
            Click "Scan for Repos" to search for git repositories containing "cassadol" in your home directory.
          </p>
        </div>
      ) : mainTab === "repos" && hasRepos ? (
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

      {/* Branch Tab */}
      {mainTab === "branch" && repoData?.selectedRepo && (
        <div className="branch-tab-content">
          {branchInfoLoading && !branchInfo ? (
            <div className="text-center py-8 text-muted">
              <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
              Loading branch info...
            </div>
          ) : branchInfo ? (
            <>
              {/* Branch Info Card */}
              <div className="settings-section">
                <h2 className="settings-section-title">
                  <GitBranch className="w-5 h-5" />
                  Current Branch
                </h2>
                <div className="settings-card">
                  <div className="branch-info-header">
                    <div className="branch-info-name">
                      <code className="text-lg">{branchInfo.currentBranch}</code>
                      {branchInfo.isPushed ? (
                        <span className="badge badge-green badge-sm">Pushed</span>
                      ) : (
                        <span className="badge badge-yellow badge-sm">Local only</span>
                      )}
                    </div>

                    {!branchInfo.isPushed && !isBaseBranch && (
                      <button
                        className="btn-primary"
                        onClick={handlePush}
                        disabled={isPushing}
                      >
                        {isPushing ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Upload className="w-4 h-4" />
                        )}
                        Push to Remote
                      </button>
                    )}
                  </div>

                  {branchInfo.parentBranch && (
                    <div className="branch-parent-info">
                      <span className="text-muted">Based on:</span>
                      <code>{branchInfo.parentBranch}</code>
                    </div>
                  )}
                </div>
              </div>

              {/* Diff Section */}
              {!isBaseBranch && (
                <div className="settings-section">
                  <div className="settings-section-header">
                    <h2 className="settings-section-title">
                      <Code className="w-5 h-5" />
                      Changes
                      {branchInfo.changedFiles && (
                        <span className="badge badge-sm ml-2">{branchInfo.changedFiles.files.length} files</span>
                      )}
                    </h2>
                    <div className="flex items-center gap-2">
                      <select
                        className="form-select-sm"
                        value={targetBranch}
                        onChange={(e) => {
                          setTargetBranch(e.target.value);
                          fetchBranchInfo(e.target.value);
                          setDiffContent(null);
                        }}
                      >
                        {baseBranches.map((b) => (
                          <option key={b.name} value={b.name}>
                            vs {b.name}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn-sm btn-secondary"
                        onClick={() => fetchDiff(targetBranch)}
                        disabled={!targetBranch || loadingDiff}
                      >
                        {loadingDiff ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3 h-3" />
                        )}
                        Load Diff
                      </button>
                    </div>
                  </div>

                  {/* Stats */}
                  {branchInfo.changedFiles && (
                    <div className="pr-stats mb-4">
                      <div className="stat">
                        <FileText className="w-4 h-4" />
                        <span>{branchInfo.changedFiles.files.length} files changed</span>
                      </div>
                      <div className="stat additions">
                        <Plus className="w-4 h-4" />
                        <span>{branchInfo.changedFiles.totalInsertions} additions</span>
                      </div>
                      <div className="stat deletions">
                        <Minus className="w-4 h-4" />
                        <span>{branchInfo.changedFiles.totalDeletions} deletions</span>
                      </div>
                    </div>
                  )}

                  {/* Diff Content */}
                  <div className="pr-diff-row">
                    {/* File List */}
                    <div className="pr-files-sidebar">
                      <div className="sidebar-header">
                        <FileText className="w-4 h-4" />
                        <span>Files</span>
                      </div>
                      <div className="file-tree">
                        {branchInfo.changedFiles?.files.length === 0 ? (
                          <div className="text-center py-4 text-muted">No changes</div>
                        ) : (
                          Array.from(groupedFiles.entries()).map(([dir, files]) => (
                            <div key={dir} className="file-group">
                              <button
                                className="file-group-header"
                                onClick={() => toggleDir(dir)}
                              >
                                {expandedDirs.has(dir) ? (
                                  <ChevronDown className="w-4 h-4" />
                                ) : (
                                  <ChevronRight className="w-4 h-4" />
                                )}
                                <span className="file-group-name">{dir}</span>
                                <span className="file-group-count">{files.length}</span>
                              </button>
                              {expandedDirs.has(dir) && (
                                <div className="file-group-files">
                                  {files.map((file) => (
                                    <button
                                      key={file.path}
                                      className={`file-item ${selectedFile === file.path ? "selected" : ""}`}
                                      onClick={() => {
                                        setSelectedFile(file.path);
                                        fetchDiff(targetBranch, file.path);
                                      }}
                                    >
                                      <FileStatusIcon status={file.status} />
                                      <span className="file-name">
                                        {file.path.split("/").pop()}
                                      </span>
                                      <div className="file-stats">
                                        {file.insertions > 0 && (
                                          <span className="additions">+{file.insertions}</span>
                                        )}
                                        {file.deletions > 0 && (
                                          <span className="deletions">-{file.deletions}</span>
                                        )}
                                      </div>
                                      <FileStatusBadge status={file.status} />
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Diff Panel */}
                    <div className="pr-diff-panel">
                      <div className="diff-viewer">
                        <div className="diff-toolbar">
                          {selectedFile && (
                            <div className="diff-file-name">
                              <button
                                className="btn-link text-sm"
                                onClick={() => {
                                  setSelectedFile(null);
                                  fetchDiff(targetBranch);
                                }}
                              >
                                Show all files
                              </button>
                              <span className="mx-2">/</span>
                              <span>{selectedFile}</span>
                            </div>
                          )}
                          <div className="diff-mode-toggle">
                            <button
                              className={`toggle-btn ${diffMode === "split" ? "active" : ""}`}
                              onClick={() => setDiffMode("split")}
                            >
                              Split
                            </button>
                            <button
                              className={`toggle-btn ${diffMode === "unified" ? "active" : ""}`}
                              onClick={() => setDiffMode("unified")}
                            >
                              Unified
                            </button>
                          </div>
                        </div>

                        {loadingDiff ? (
                          <div className="text-center py-8 text-muted">
                            <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                            Loading diff...
                          </div>
                        ) : !diffContent ? (
                          <div className="text-center py-8 text-muted">
                            Click "Load Diff" or select a file to view changes
                          </div>
                        ) : parsedDiffs.length === 0 ? (
                          <div className="text-center py-8 text-muted">
                            No changes to display
                          </div>
                        ) : (
                          <div className="diff-content">
                            {parsedDiffs.map((fileDiff, index) => (
                              <div key={fileDiff.fileName + index} className="diff-file-section">
                                <div className="diff-file-header">{fileDiff.fileName}</div>
                                <DiffView
                                  data={{
                                    oldFile: { fileName: fileDiff.fileName, fileLang: getFileLang(fileDiff.fileName) },
                                    newFile: { fileName: fileDiff.fileName, fileLang: getFileLang(fileDiff.fileName) },
                                    hunks: [fileDiff.diffString],
                                  }}
                                  diffViewFontSize={13}
                                  diffViewMode={diffMode === "split" ? DiffModeEnum.Split : DiffModeEnum.Unified}
                                  diffViewWrap={true}
                                  diffViewTheme={isDarkMode ? "dark" : "light"}
                                  diffViewHighlight={true}
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-muted">
              Failed to load branch info. Make sure a repo is selected.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
