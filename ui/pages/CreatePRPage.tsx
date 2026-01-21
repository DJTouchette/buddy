import React, { useEffect, useState, useMemo } from "react";
import {
  ArrowLeft,
  GitBranch,
  GitMerge,
  FileText,
  GitCommit,
  Code,
  Plus,
  Minus,
  Loader2,
  AlertCircle,
  Upload,
  Send,
  FileDiff,
  ChevronDown,
  ChevronRight,
  Edit3,
} from "lucide-react";
import { DiffView, DiffModeEnum } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view.css";
import { BranchCombobox } from "../components/BranchCombobox";

interface CreatePRPageProps {
  navigate: (path: string) => void;
}

interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  insertions: number;
  deletions: number;
}

interface Commit {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  date: string;
}

interface PRInfo {
  repo: { name: string; path: string };
  currentBranch: string;
  upstreamBranch: string | null;
  parentBranch: string | null;
  isPushed: boolean;
  remoteBranches: string[];
  baseBranches: string[];
  changedFiles: {
    files: FileChange[];
    totalInsertions: number;
    totalDeletions: number;
  } | null;
  commits: Commit[] | null;
}

type TabType = "commits" | "diff";
type MainTab = "details" | "changes";

function FileStatusIcon({ status }: { status: FileChange["status"] }) {
  switch (status) {
    case "added":
      return <Plus className="w-4 h-4 text-green-500" />;
    case "deleted":
      return <Minus className="w-4 h-4 text-red-500" />;
    case "renamed":
      return <GitBranch className="w-4 h-4 text-blue-500" />;
    default:
      return <FileDiff className="w-4 h-4 text-yellow-500" />;
  }
}

function FileStatusBadge({ status }: { status: FileChange["status"] }) {
  const classes: Record<FileChange["status"], string> = {
    added: "badge-green",
    deleted: "badge-red",
    modified: "badge-yellow",
    renamed: "badge-blue",
  };

  return (
    <span className={`badge badge-sm ${classes[status]}`}>
      {status}
    </span>
  );
}

export function CreatePRPage({ navigate }: CreatePRPageProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prInfo, setPrInfo] = useState<PRInfo | null>(null);
  const [targetBranch, setTargetBranch] = useState<string>("");
  const [mainTab, setMainTab] = useState<MainTab>("details");
  const [activeTab, setActiveTab] = useState<TabType>("diff");

  // Form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [isPushing, setIsPushing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [addJiraComment, setAddJiraComment] = useState(true); // Pre-checked by default
  const [moveToCodeReview, setMoveToCodeReview] = useState(true); // Pre-checked by default

  // Diff state
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);
  const [diffMode, setDiffMode] = useState<"split" | "unified">("split");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  // Detect dark mode from :root.dark class
  const [isDarkMode, setIsDarkMode] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  // Extract JIRA ticket key from branch name (e.g., "CAS-123-some-feature" -> "CAS-123")
  const getTicketKeyFromBranch = (branch: string): string | null => {
    const match = branch.match(/^([A-Z]+-\d+)/i);
    return match ? match[1].toUpperCase() : null;
  };

  const ticketKey = prInfo?.currentBranch ? getTicketKeyFromBranch(prInfo.currentBranch) : null;

  // Map file extensions to language identifiers for syntax highlighting
  const getFileLang = (fileName: string): string => {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const langMap: Record<string, string> = {
      'ts': 'typescript',
      'tsx': 'tsx',
      'js': 'javascript',
      'jsx': 'jsx',
      'json': 'json',
      'md': 'markdown',
      'css': 'css',
      'scss': 'scss',
      'less': 'less',
      'html': 'xml',
      'xml': 'xml',
      'yaml': 'yaml',
      'yml': 'yaml',
      'py': 'python',
      'rb': 'ruby',
      'go': 'go',
      'rs': 'rust',
      'java': 'java',
      'cs': 'csharp',
      'cpp': 'cpp',
      'c': 'c',
      'h': 'c',
      'hpp': 'cpp',
      'sh': 'bash',
      'bash': 'bash',
      'sql': 'sql',
      'graphql': 'graphql',
      'swift': 'swift',
      'kt': 'kotlin',
      'php': 'php',
    };
    return langMap[ext] || 'plaintext';
  };

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  // Parse diff content into individual file diffs
  // The @git-diff-view library expects each hunk to be a complete diff string
  // that starts with "--- " and includes the full unified diff format
  const parsedDiffs = useMemo(() => {
    if (!diffContent) return [];

    const fileDiffs: Array<{ fileName: string; diffString: string }> = [];

    // Split by "diff --git" to get each file's diff section
    const sections = diffContent.split(/(?=^diff --git )/m);

    for (const section of sections) {
      if (!section.trim()) continue;

      // Extract filename from "diff --git a/path/file b/path/file"
      const headerMatch = section.match(/^diff --git a\/(.+) b\/(.+)/m);
      const fileName = headerMatch?.[2] ?? "file";

      // Find where the actual diff content starts (--- line)
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

  // Fetch PR info on mount
  useEffect(() => {
    fetchPRInfo();
  }, []);

  // Refetch with target when target changes
  useEffect(() => {
    if (targetBranch) {
      fetchPRInfo(targetBranch);
    }
  }, [targetBranch]);

  // Auto-generate title and description from branch name and JIRA ticket
  useEffect(() => {
    if (prInfo?.currentBranch && !title) {
      // Extract ticket key and convert branch name to title
      const branch = prInfo.currentBranch;
      const ticketMatch = branch.match(/^([A-Z]+-\d+)/);
      const ticketKey = ticketMatch ? ticketMatch[1] : "";

      // Convert rest of branch name to readable title
      const rest = ticketMatch
        ? branch.slice(ticketMatch[0].length).replace(/^-/, "")
        : branch;
      const readableTitle = rest
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");

      const generatedTitle = ticketKey ? `${ticketKey}: ${readableTitle}` : readableTitle;
      setTitle(generatedTitle);

      // Fetch JIRA ticket and prefill description
      if (ticketKey && !description) {
        fetchTicketAndPrefillDescription(ticketKey, generatedTitle);
      }
    }
  }, [prInfo?.currentBranch]);

  const fetchTicketAndPrefillDescription = async (ticketKey: string, prTitle: string) => {
    try {
      const response = await fetch(`/api/jira/tickets/${ticketKey}`);
      if (!response.ok) return;

      const data = await response.json();
      const ticket = data.issue;
      const jiraHost = data.jiraHost;

      if (ticket) {
        const ticketUrl = `https://${jiraHost}/browse/${ticketKey}`;
        const ticketSummary = ticket.summary || "Add the task's description here...";
        const ticketDescription = ticket.description || "";

        const template = `### Description

[${ticketSummary}](${ticketUrl})

${ticketDescription}

### How to test/reproduce

- Step 1
- Step 2
- Step 3
- Step 4...


${prTitle}`;

        setDescription(template);
      }
    } catch (err) {
      // Silently fail - description prefill is optional
      console.error("Failed to fetch JIRA ticket for description:", err);
    }
  };

  // Set default target branch
  useEffect(() => {
    if (prInfo && !targetBranch) {
      // Prefer parent branch (detected via merge-base), then upstream, then first base branch
      const defaultTarget =
        prInfo.parentBranch ||
        prInfo.upstreamBranch ||
        prInfo.baseBranches[0] ||
        prInfo.remoteBranches.find((b) => b === "master" || b === "main") ||
        prInfo.remoteBranches[0];
      if (defaultTarget) {
        setTargetBranch(defaultTarget);
      }
    }
  }, [prInfo, targetBranch]);

  const fetchPRInfo = async (target?: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = target
        ? `/api/git/pr-info?target=${encodeURIComponent(target)}`
        : "/api/git/pr-info";
      const response = await fetch(url);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch PR info");
      }

      setPrInfo(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load PR info");
    } finally {
      setLoading(false);
    }
  };

  const fetchFileDiff = async (filePath: string) => {
    if (!targetBranch) return;

    setLoadingDiff(true);
    setSelectedFile(filePath);
    try {
      const response = await fetch(
        `/api/git/diff?target=${encodeURIComponent(targetBranch)}&file=${encodeURIComponent(filePath)}`
      );
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

  const fetchFullDiff = async () => {
    if (!targetBranch) return;

    setLoadingDiff(true);
    setSelectedFile(null);
    try {
      const response = await fetch(
        `/api/git/diff?target=${encodeURIComponent(targetBranch)}`
      );
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

  const handlePush = async () => {
    setIsPushing(true);
    setCreateError(null);
    try {
      const response = await fetch("/api/git/push", { method: "POST" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Push failed");
      }

      // Refresh PR info
      await fetchPRInfo(targetBranch);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Push failed");
    } finally {
      setIsPushing(false);
    }
  };

  const handleCreatePR = async (isDraft: boolean) => {
    if (!title.trim() || !targetBranch) return;

    setIsCreating(true);
    setCreateError(null);
    try {
      const response = await fetch("/api/git/create-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          targetBranch,
          isDraft,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to create PR");
      }

      // Add JIRA comment if checkbox is checked and we have a ticket key
      if (addJiraComment && ticketKey && data.pr?.webUrl) {
        try {
          await fetch(`/api/jira/tickets/${ticketKey}/comment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              comment: "PR:",
              url: data.pr.webUrl,
              linkText: `PR #${data.pr.pullRequestId} - ${data.pr.title}`,
            }),
          });
        } catch (commentErr) {
          // Don't fail the PR creation if comment fails
          console.error("Failed to add JIRA comment:", commentErr);
        }
      }

      // Move ticket to Code Review if checkbox is checked
      if (moveToCodeReview && ticketKey) {
        try {
          await fetch(`/api/jira/tickets/${ticketKey}/transition`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              statusName: "Code Review",
            }),
          });
        } catch (transitionErr) {
          // Don't fail the PR creation if transition fails
          console.error("Failed to move ticket to Code Review:", transitionErr);
        }
      }

      // Navigate to the new PR
      navigate(`/prs/${data.pr.pullRequestId}`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create PR");
    } finally {
      setIsCreating(false);
    }
  };

  // Group files by directory
  const groupedFiles = useMemo(() => {
    if (!prInfo?.changedFiles?.files) return new Map<string, FileChange[]>();

    const groups = new Map<string, FileChange[]>();

    for (const file of prInfo.changedFiles.files) {
      const parts = file.path.split("/");
      const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";

      if (!groups.has(dir)) {
        groups.set(dir, []);
      }
      groups.get(dir)!.push(file);
    }

    return groups;
  }, [prInfo?.changedFiles?.files]);

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

  // Auto-expand all directories on first load
  useEffect(() => {
    if (groupedFiles.size > 0 && expandedDirs.size === 0) {
      setExpandedDirs(new Set(groupedFiles.keys()));
    }
  }, [groupedFiles]);

  if (loading && !prInfo) {
    return (
      <div className="text-center py-8 text-muted">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
        Loading branch info...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <div className="text-red-500 mb-4">{error}</div>
        <button onClick={() => navigate("/prs")} className="btn-secondary">
          <ArrowLeft className="w-4 h-4" />
          Back to PRs
        </button>
      </div>
    );
  }

  if (!prInfo) return null;

  const isBaseBranch = prInfo.baseBranches.includes(prInfo.currentBranch);
  const canCreatePR = !isBaseBranch && title.trim() && targetBranch;

  return (
    <div className="create-pr-page">
      {/* Header with main tabs */}
      <div className="create-pr-header">
        <div className="detail-page-header">
          <button onClick={() => navigate("/prs")} className="btn-secondary">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <h1>Create Pull Request</h1>
        </div>

        {/* Main Tabs */}
        <div className="main-tabs">
          <button
            className={`main-tab ${mainTab === "details" ? "active" : ""}`}
            onClick={() => setMainTab("details")}
          >
            <Edit3 className="w-4 h-4" />
            Details
          </button>
          <button
            className={`main-tab ${mainTab === "changes" ? "active" : ""}`}
            onClick={() => {
              setMainTab("changes");
              if (!diffContent && !loadingDiff) {
                fetchFullDiff();
              }
            }}
          >
            <Code className="w-4 h-4" />
            Changes
            {prInfo.changedFiles && (
              <span className="tab-count">{prInfo.changedFiles.files.length}</span>
            )}
          </button>
        </div>
      </div>

      {/* Warning if on base branch */}
      {isBaseBranch && (
        <div className="alert alert-warning">
          <AlertCircle className="w-5 h-5" />
          <span>
            You're on a base branch ({prInfo.currentBranch}). Create a feature
            branch first before creating a PR.
          </span>
        </div>
      )}

      {/* Warning if branch not pushed */}
      {!isBaseBranch && !prInfo.isPushed && (
        <div className="alert alert-info">
          <Upload className="w-5 h-5" />
          <div className="alert-content">
            <strong>Branch not pushed to remote</strong>
            <span>You need to push your branch before creating a PR. Click "Push Branch" below or use the button here.</span>
          </div>
          <button
            className="btn-primary btn-sm"
            onClick={handlePush}
            disabled={isPushing}
          >
            {isPushing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            Push Now
          </button>
        </div>
      )}

      {/* Details Tab Content */}
      {mainTab === "details" && (
        <div className="pr-details-content">
          {/* Branch Flow */}
          <div className="pr-branch-flow">
            <div className="branch-box source">
              <div className="branch-label">Source</div>
              <div className="branch-name">
                <GitBranch className="w-4 h-4" />
                <code>{prInfo.currentBranch}</code>
                {prInfo.isPushed ? (
                  <span className="badge badge-green badge-sm">Pushed</span>
                ) : (
                  <span className="badge badge-yellow badge-sm">Local only</span>
                )}
              </div>
            </div>

            <div className="branch-arrow">
              <GitMerge className="w-5 h-5" />
            </div>

            <div className="branch-box target">
              <div className="branch-label">Target</div>
              <BranchCombobox
                value={targetBranch}
                onChange={setTargetBranch}
                branches={prInfo.remoteBranches}
                baseBranches={prInfo.baseBranches}
                placeholder="Select target branch..."
              />
            </div>
          </div>

          {/* Stats Summary */}
          {prInfo.changedFiles && (
            <div className="pr-stats">
              <div className="stat">
                <FileText className="w-4 h-4" />
                <span>{prInfo.changedFiles.files.length} files changed</span>
              </div>
              <div className="stat additions">
                <Plus className="w-4 h-4" />
                <span>{prInfo.changedFiles.totalInsertions} additions</span>
              </div>
              <div className="stat deletions">
                <Minus className="w-4 h-4" />
                <span>{prInfo.changedFiles.totalDeletions} deletions</span>
              </div>
              {prInfo.commits && (
                <div className="stat">
                  <GitCommit className="w-4 h-4" />
                  <span>{prInfo.commits.length} commits</span>
                </div>
              )}
            </div>
          )}

          {/* PR Form */}
          <div className="pr-form-full">
            <div className="form-section">
              <label className="form-label">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="PR title..."
                className="form-input"
              />
            </div>

            <div className="form-section">
              <label className="form-label">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe your changes..."
                className="form-textarea"
              />
            </div>

            {/* JIRA Options */}
            {ticketKey && (
              <div className="form-section">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={addJiraComment}
                    onChange={(e) => setAddJiraComment(e.target.checked)}
                  />
                  <span>Add comment to JIRA ticket ({ticketKey}) with PR link</span>
                </label>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={moveToCodeReview}
                    onChange={(e) => setMoveToCodeReview(e.target.checked)}
                  />
                  <span>Move ticket to Code Review</span>
                </label>
              </div>
            )}

            {/* Error message */}
            {createError && (
              <div className="transition-error">
                <AlertCircle className="w-4 h-4" />
                {createError}
              </div>
            )}

            {/* Actions */}
            <div className="pr-form-actions-row">
              {!prInfo.isPushed && (
                <button
                  className="btn-secondary"
                  onClick={handlePush}
                  disabled={isPushing || isBaseBranch}
                >
                  {isPushing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Upload className="w-4 h-4" />
                  )}
                  Push Branch
                </button>
              )}

              <button
                className="btn-secondary"
                onClick={() => handleCreatePR(true)}
                disabled={isCreating || !canCreatePR}
              >
                {isCreating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FileText className="w-4 h-4" />
                )}
                Create Draft
              </button>

              <button
                className="btn-primary"
                onClick={() => handleCreatePR(false)}
                disabled={isCreating || !canCreatePR}
              >
                {isCreating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Create PR
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Changes Tab Content */}
      {mainTab === "changes" && (
        <div className="pr-diff-row">
        {/* Left Sidebar - Files */}
        <div className="pr-files-sidebar">
          <div className="sidebar-header">
            <FileText className="w-4 h-4" />
            <span>Changed Files</span>
            {prInfo.changedFiles && (
              <span className="badge badge-sm">{prInfo.changedFiles.files.length}</span>
            )}
          </div>
          <div className="file-tree">
            {loading ? (
              <div className="text-center py-4 text-muted">
                <Loader2 className="w-4 h-4 animate-spin mx-auto" />
              </div>
            ) : prInfo.changedFiles?.files.length === 0 ? (
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
                            fetchFileDiff(file.path);
                            setActiveTab("diff");
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

        {/* Right Panel - Tabs (Commits/Diff only) */}
        <div className="pr-diff-panel">
          {/* Tabs */}
          <div className="pr-tabs">
            <button
              className={`pr-tab ${activeTab === "commits" ? "active" : ""}`}
              onClick={() => setActiveTab("commits")}
            >
              <GitCommit className="w-4 h-4" />
              Commits
              {prInfo.commits && (
                <span className="tab-count">{prInfo.commits.length}</span>
              )}
            </button>
            <button
              className={`pr-tab ${activeTab === "diff" ? "active" : ""}`}
              onClick={() => {
                setActiveTab("diff");
                if (!diffContent && !loadingDiff) {
                  fetchFullDiff();
                }
              }}
            >
              <Code className="w-4 h-4" />
              Diff
            </button>
          </div>

          {/* Tab Content */}
          <div className="pr-tab-content">
            {loading && (
              <div className="text-center py-8 text-muted">
                <Loader2 className="w-5 h-5 animate-spin mx-auto" />
              </div>
            )}

            {!loading && activeTab === "commits" && (
              <div className="commit-list">
                {!prInfo.commits || prInfo.commits.length === 0 ? (
                  <div className="text-center py-4 text-muted">No commits</div>
                ) : (
                  prInfo.commits.map((commit) => (
                    <div key={commit.hash} className="commit-item">
                      <div className="commit-icon">
                        <GitCommit className="w-4 h-4" />
                      </div>
                      <div className="commit-info">
                        <div className="commit-subject">{commit.subject}</div>
                        <div className="commit-meta">
                          <code className="commit-hash">{commit.shortHash}</code>
                          <span className="commit-author">{commit.author}</span>
                          <span className="commit-date">{commit.date}</span>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {!loading && activeTab === "diff" && (
              <div className="diff-viewer">
                {/* Diff toolbar */}
                <div className="diff-toolbar">
                  {selectedFile && (
                    <div className="diff-file-name">
                      <button
                        className="btn-link text-sm"
                        onClick={() => {
                          setSelectedFile(null);
                          fetchFullDiff();
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

                {/* Diff content */}
                {loadingDiff ? (
                  <div className="text-center py-8 text-muted">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                    Loading diff...
                  </div>
                ) : !diffContent ? (
                  <div className="text-center py-8 text-muted">
                    {targetBranch
                      ? "No changes to display"
                      : "Select a target branch to see diff"}
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
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
