import React, { useEffect, useState, useCallback } from "react";
import { ArrowLeft, ExternalLink, GitBranch, GitMerge, User, UserPlus, Users, FileText, CheckCircle, XCircle, Clock, Ticket, Download, Loader2, Check, X, Maximize2, Minimize2, Pencil, Save, AlertCircle, MessageSquare, Code, ThumbsUp, ThumbsDown, MinusCircle } from "lucide-react";
import { NotesEditor } from "../components/NotesEditor";
import { Markdown } from "../components/Markdown";
import type { PRWithTicket } from "../../services/linkingService";
import type { PRReviewer } from "../../services/azureDevOpsService";

interface PRThreadComment {
  id: number;
  content: string;
  author: {
    displayName: string;
    imageUrl?: string;
  };
  publishedDate: string;
  lastUpdatedDate: string;
  commentType: string;
}

interface PRThread {
  id: number;
  status: string;
  comments: PRThreadComment[];
  threadContext?: {
    filePath?: string;
    rightFileStart?: { line: number };
    rightFileEnd?: { line: number };
  };
  publishedDate: string;
  lastUpdatedDate: string;
  isDeleted: boolean;
  webUrl: string;
}

interface PRStatus {
  id: number;
  state: string;
  description: string;
  context: {
    name: string;
    genre: string;
  };
  targetUrl?: string;
}

interface PRCheck {
  id: string;
  name: string;
  status: "approved" | "rejected" | "running" | "queued" | "notApplicable" | "broken";
  isBlocking: boolean;
  type: string;
  buildId?: number;
  buildUrl?: string;
}

interface PRDetailPageProps {
  prId: string;
  navigate: (path: string) => void;
}

function PRStatusBadge({ status }: { status: string }) {
  const badgeClass: Record<string, string> = {
    active: "badge-green",
    completed: "badge-blue",
    abandoned: "badge-gray",
  };

  return (
    <span className={`badge ${badgeClass[status] || "badge-gray"}`}>
      {status}
    </span>
  );
}

function StatusIcon({ state }: { state: string }) {
  switch (state) {
    case "succeeded":
      return <CheckCircle className="w-4 h-4 status-success" />;
    case "failed":
    case "error":
      return <XCircle className="w-4 h-4 status-error" />;
    default:
      return <Clock className="w-4 h-4 status-pending" />;
  }
}

function CheckStatusIcon({ status }: { status: PRCheck["status"] }) {
  switch (status) {
    case "approved":
      return <CheckCircle className="w-4 h-4 status-success" />;
    case "rejected":
    case "broken":
      return <XCircle className="w-4 h-4 status-error" />;
    case "running":
    case "queued":
      return <Clock className="w-4 h-4 status-pending" />;
    default:
      return <Clock className="w-4 h-4 text-muted" />;
  }
}

function getApprovalStatus(reviewers?: PRReviewer[]): { status: "approved" | "rejected" | "pending" | "waiting"; approvedCount: number; totalCount: number } {
  if (!reviewers || reviewers.length === 0) {
    return { status: "pending", approvedCount: 0, totalCount: 0 };
  }

  const individualReviewers = reviewers.filter(r => !r.isContainer);
  const approvedCount = individualReviewers.filter(r => r.vote >= 5).length;
  const rejectedCount = individualReviewers.filter(r => r.vote === -10).length;
  const waitingCount = individualReviewers.filter(r => r.vote === -5).length;

  if (rejectedCount > 0) {
    return { status: "rejected", approvedCount, totalCount: individualReviewers.length };
  }
  if (waitingCount > 0) {
    return { status: "waiting", approvedCount, totalCount: individualReviewers.length };
  }
  if (approvedCount > 0 && approvedCount === individualReviewers.length) {
    return { status: "approved", approvedCount, totalCount: individualReviewers.length };
  }
  if (approvedCount > 0) {
    return { status: "pending", approvedCount, totalCount: individualReviewers.length };
  }
  return { status: "pending", approvedCount: 0, totalCount: individualReviewers.length };
}

function ApprovalBadge({ reviewers }: { reviewers?: PRReviewer[] }) {
  const { status, approvedCount, totalCount } = getApprovalStatus(reviewers);

  if (totalCount === 0) {
    return null;
  }

  const statusConfig = {
    approved: { icon: ThumbsUp, className: "approval-approved", label: "Approved" },
    rejected: { icon: ThumbsDown, className: "approval-rejected", label: "Rejected" },
    waiting: { icon: Clock, className: "approval-waiting", label: "Changes requested" },
    pending: { icon: MinusCircle, className: "approval-pending", label: `${approvedCount}/${totalCount} approved` },
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={`approval-badge ${config.className}`}>
      <Icon className="w-3 h-3" />
      <span>{config.label}</span>
    </div>
  );
}

function DetailRow({ icon: Icon, label, children }: { icon: React.ElementType; label: string; children: React.ReactNode }) {
  return (
    <div className="detail-row">
      <div className="detail-label">
        <Icon className="w-4 h-4" />
        <span>{label}</span>
      </div>
      <div className="detail-value">{children}</div>
    </div>
  );
}

export function PRDetailPage({ prId, navigate }: PRDetailPageProps) {
  const [pr, setPr] = useState<PRWithTicket | null>(null);
  const [jiraHost, setJiraHost] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<PRStatus[]>([]);
  const [checks, setChecks] = useState<PRCheck[]>([]);
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState<{ success: boolean; message: string } | null>(null);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);

  // Description editing state
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedDescription, setEditedDescription] = useState("");
  const [isSavingDescription, setIsSavingDescription] = useState(false);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);

  // Comments state
  const [comments, setComments] = useState<PRThread[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);

  // Reviewer state
  const [isAddingReviewer, setIsAddingReviewer] = useState(false);

  const fetchPR = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/prs/${prId}`);
      if (!response.ok) {
        throw new Error("PR not found");
      }
      const data = await response.json();
      setPr(data.pr);
      setJiraHost(data.jiraHost || "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load PR");
    } finally {
      setLoading(false);
    }
  }, [prId]);

  useEffect(() => {
    fetchPR();
    setCheckoutResult(null);
    setCurrentBranch(null);

    // Fetch current branch
    fetch("/api/git/current-branch")
      .then(res => res.json())
      .then(data => {
        if (data.branch) {
          setCurrentBranch(data.branch);
        }
      })
      .catch(() => {});
  }, [prId, fetchPR]);

  // Fetch PR statuses and checks when PR is loaded
  useEffect(() => {
    if (pr) {
      setLoadingStatuses(true);
      fetch(`/api/prs/${pr.pullRequestId}/statuses`)
        .then((res) => res.json())
        .then((data) => {
          console.log("PR statuses response:", data);
          if (data.checks) {
            setChecks(data.checks);
          }
          if (data.statuses) {
            setStatuses(data.statuses);
          }
        })
        .catch((err) => {
          console.error("Failed to fetch PR statuses:", err);
        })
        .finally(() => {
          setLoadingStatuses(false);
        });
    }
  }, [pr?.pullRequestId]);

  // Fetch PR comments when PR is loaded
  useEffect(() => {
    if (pr) {
      setLoadingComments(true);
      fetch(`/api/prs/${pr.pullRequestId}/comments`)
        .then((res) => res.json())
        .then((data) => {
          if (data.threads) {
            setComments(data.threads);
          }
        })
        .catch(() => {})
        .finally(() => {
          setLoadingComments(false);
        });
    }
  }, [pr?.pullRequestId]);

  const handleTicketClick = (ticketKey: string) => {
    // Set highlight so when user comes back to PR list, this PR is highlighted
    sessionStorage.setItem("highlightPR", prId);
    navigate(`/tickets/${ticketKey}`);
  };

  const handleBack = () => {
    window.history.back();
  };

  const handleCheckout = async () => {
    if (!pr) return;
    const sourceBranch = pr.sourceRefName.replace("refs/heads/", "");

    setCheckoutLoading(true);
    setCheckoutResult(null);

    try {
      const response = await fetch("/api/git/checkout-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchName: sourceBranch }),
      });

      const data = await response.json();

      if (response.ok) {
        setCheckoutResult({
          success: true,
          message: `Checked out ${data.branchName} in ${data.repoName}`,
        });
        setCurrentBranch(data.branchName);
        setTimeout(() => setCheckoutResult(null), 5000);
      } else {
        setCheckoutResult({
          success: false,
          message: data.error || "Checkout failed",
        });
      }
    } catch (err) {
      setCheckoutResult({
        success: false,
        message: "Failed to checkout branch",
      });
    } finally {
      setCheckoutLoading(false);
    }
  };

  const handleEditDescription = () => {
    if (!pr) return;
    setEditedDescription(pr.description || "");
    setIsEditingDescription(true);
    setDescriptionError(null);
  };

  const handleCancelEdit = () => {
    setIsEditingDescription(false);
    setEditedDescription("");
    setDescriptionError(null);
  };

  const handleSaveDescription = async () => {
    if (!pr) return;
    setIsSavingDescription(true);
    setDescriptionError(null);

    try {
      const response = await fetch(`/api/prs/${pr.pullRequestId}/description`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: editedDescription }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Update the PR with new description
        setPr({
          ...pr,
          description: data.pr.description,
        });
        setIsEditingDescription(false);
        setEditedDescription("");
      } else {
        setDescriptionError(data.error || "Failed to save description");
      }
    } catch (err) {
      setDescriptionError("Failed to save description");
    } finally {
      setIsSavingDescription(false);
    }
  };

  const handleAddSelfAsReviewer = async () => {
    if (!pr) return;

    setIsAddingReviewer(true);

    try {
      const response = await fetch(`/api/prs/${pr.pullRequestId}/reviewers/self`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Update the PR with new reviewers
        setPr({
          ...pr,
          reviewers: data.pr.reviewers,
        });
      }
    } catch (err) {
      // Silently fail - user can try again
    } finally {
      setIsAddingReviewer(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-muted">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
        Loading PR...
      </div>
    );
  }

  if (error || !pr) {
    return (
      <div className="text-center py-8">
        <div className="text-red-500 mb-4">{error || "PR not found"}</div>
        <button onClick={() => navigate("/prs")} className="btn-secondary">
          <ArrowLeft className="w-4 h-4" />
          Back to PRs
        </button>
      </div>
    );
  }

  const sourceBranch = pr.sourceRefName.replace("refs/heads/", "");
  const targetBranch = pr.targetRefName.replace("refs/heads/", "");
  const isCheckedOut = currentBranch === sourceBranch;

  return (
    <div className="detail-page">
      {/* Back button and title */}
      <div className="detail-page-header">
        <button onClick={handleBack} className="btn-secondary">
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
        <div className="detail-page-title">
          <h1>PR #{pr.pullRequestId}</h1>
          {isCheckedOut && (
            <div className="checked-out-badge">
              <Check className="w-4 h-4" />
              <span>Checked out</span>
            </div>
          )}
        </div>
      </div>

      <div className="pr-detail">
        {/* Header with title */}
        <div className="detail-header">
          <h3 className="detail-summary">{pr.title}</h3>
          <div className="detail-header-actions">
            {!isCheckedOut && (
              <button
                className="btn-secondary"
                onClick={handleCheckout}
                disabled={checkoutLoading}
                title="Checkout this PR branch"
              >
                {checkoutLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Checkout
              </button>
            )}
            <a href={pr.webUrl} target="_blank" rel="noopener noreferrer" className="btn-link">
              Open in Azure DevOps <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* Checkout result message */}
        {checkoutResult && (
          <div className={`checkout-result ${checkoutResult.success ? "success" : "error"}`}>
            {checkoutResult.success ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
            {checkoutResult.message}
          </div>
        )}

        {/* Status */}
        <div className="detail-badges">
          <PRStatusBadge status={pr.status} />
          <ApprovalBadge reviewers={pr.reviewers} />
        </div>

        {/* Branch Info */}
        <div className="branch-flow">
          <div className="branch-name">
            <GitBranch className="w-4 h-4" />
            <code>{sourceBranch}</code>
          </div>
          <div className="branch-arrow">→</div>
          <div className="branch-name">
            <GitMerge className="w-4 h-4" />
            <code>{targetBranch}</code>
          </div>
        </div>

        {/* Details Grid */}
        <div className="detail-grid">
          <DetailRow icon={User} label="Created By">
            {pr.createdBy.displayName}
          </DetailRow>

          <DetailRow icon={GitBranch} label="Source Branch">
            <code>{sourceBranch}</code>
          </DetailRow>

          <DetailRow icon={GitMerge} label="Target Branch">
            <code>{targetBranch}</code>
          </DetailRow>
        </div>

        {/* Reviewers Section */}
        <div className="detail-section">
          <div className="detail-section-header">
            <h4 className="detail-section-title">
              <Users className="w-4 h-4" /> Reviewers
              {pr.reviewers && pr.reviewers.length > 0 && (
                <span className="badge badge-sm ml-2">{pr.reviewers.filter(r => !r.isContainer).length}</span>
              )}
            </h4>
            <div className="detail-section-actions">
              <button
                className="btn-sm btn-secondary"
                onClick={handleAddSelfAsReviewer}
                disabled={isAddingReviewer}
                title="Add yourself as a reviewer"
              >
                {isAddingReviewer ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <UserPlus className="w-3 h-3" />
                )}
                Add myself
              </button>
            </div>
          </div>
          {pr.reviewers && pr.reviewers.filter(r => !r.isContainer).length > 0 ? (
            <div className="reviewer-list">
              {pr.reviewers.filter(r => !r.isContainer).map((reviewer) => (
                <div key={reviewer.id} className="reviewer-item">
                  <User className="w-4 h-4" />
                  <span className="reviewer-name">{reviewer.displayName}</span>
                  <span className={`badge badge-sm ${
                    reviewer.vote >= 10 ? "badge-green" :
                    reviewer.vote >= 5 ? "badge-blue" :
                    reviewer.vote === -5 ? "badge-yellow" :
                    reviewer.vote === -10 ? "badge-red" :
                    "badge-gray"
                  }`}>
                    {reviewer.vote >= 10 ? "Approved" :
                     reviewer.vote >= 5 ? "Approved with suggestions" :
                     reviewer.vote === -5 ? "Waiting for author" :
                     reviewer.vote === -10 ? "Rejected" :
                     "No vote"}
                  </span>
                  {reviewer.isRequired && (
                    <span className="text-xs text-muted">(required)</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted">No reviewers assigned</div>
          )}
        </div>

        {/* Linked Ticket */}
        {pr.linkedTicket && (
          <div className="detail-section">
            <h4 className="detail-section-title">
              <Ticket className="w-4 h-4" /> Linked JIRA Ticket
            </h4>
            <div className="detail-card clickable-card" onClick={() => handleTicketClick(pr.linkedTicket!.key)}>
              <div className="detail-card-header">
                <button className="jira-ticket-link">
                  {pr.linkedTicket.key}: {pr.linkedTicket.fields.summary}
                </button>
              </div>
              <div className="detail-card-meta">
                <span className={`badge ${pr.linkedTicket.fields.status.name === "Done" ? "badge-green" : "badge-blue"}`}>
                  {pr.linkedTicket.fields.status.name}
                </span>
                <span className="text-muted text-xs">Click to view ticket</span>
              </div>
            </div>
          </div>
        )}

        {/* Build/Check Statuses */}
        <div className="detail-section">
          <h4 className="detail-section-title">
            <CheckCircle className="w-4 h-4" /> Status Checks ({checks.length})
          </h4>
          {loadingStatuses ? (
            <div className="text-muted">Loading status checks...</div>
          ) : checks.length > 0 || statuses.length > 0 ? (
            <div className="status-list">
              {/* Policy evaluations (builds, required reviewers, etc.) */}
              {checks.map((check) => (
                <div key={check.id} className="status-item">
                  <CheckStatusIcon status={check.status} />
                  <div className="status-info">
                    <div className="status-name">
                      {check.buildUrl ? (
                        <a href={check.buildUrl} target="_blank" rel="noopener noreferrer" className="check-link">
                          {check.name}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        check.name
                      )}
                    </div>
                    <div className="status-description">
                      {check.type}
                      {check.isBlocking && <span className="text-xs ml-2">(Required)</span>}
                    </div>
                  </div>
                  <span className={`badge badge-${
                    check.status === "approved" ? "green" :
                    check.status === "rejected" || check.status === "broken" ? "red" :
                    check.status === "running" || check.status === "queued" ? "yellow" :
                    "gray"
                  }`}>
                    {check.status}
                  </span>
                </div>
              ))}
              {/* Custom statuses */}
              {statuses.map((status) => (
                <div key={status.id} className="status-item">
                  <StatusIcon state={status.state} />
                  <div className="status-info">
                    <div className="status-name">{status.context.name}</div>
                    <div className="status-description">{status.description}</div>
                  </div>
                  <span className={`badge badge-${status.state === "succeeded" ? "green" : status.state === "failed" ? "red" : "gray"}`}>
                    {status.state}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted">No status checks found</div>
          )}
        </div>

        {/* Description */}
        <div className="detail-section">
          <div className="detail-section-header">
            <h4 className="detail-section-title">
              <FileText className="w-4 h-4" /> Description
            </h4>
            <div className="detail-section-actions">
              {!isEditingDescription && (
                <>
                  <button
                    className="btn-icon-sm"
                    onClick={handleEditDescription}
                    title="Edit description"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  {pr.description && (
                    <button
                      className="btn-icon-sm"
                      onClick={() => setDescriptionExpanded(!descriptionExpanded)}
                      title={descriptionExpanded ? "Collapse" : "Expand"}
                    >
                      {descriptionExpanded ? (
                        <Minimize2 className="w-4 h-4" />
                      ) : (
                        <Maximize2 className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {isEditingDescription ? (
            <div className="description-edit">
              <textarea
                className="description-textarea"
                value={editedDescription}
                onChange={(e) => setEditedDescription(e.target.value)}
                placeholder="Enter description (markdown supported)..."
                rows={10}
                disabled={isSavingDescription}
              />
              {descriptionError && (
                <div className="transition-error">
                  <AlertCircle className="w-4 h-4" />
                  {descriptionError}
                </div>
              )}
              <div className="description-edit-actions">
                <button
                  className="btn-secondary"
                  onClick={handleCancelEdit}
                  disabled={isSavingDescription}
                >
                  <X className="w-4 h-4" />
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={handleSaveDescription}
                  disabled={isSavingDescription}
                >
                  {isSavingDescription ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save
                </button>
              </div>
            </div>
          ) : pr.description ? (
            <Markdown content={pr.description} className={descriptionExpanded ? "expanded" : ""} />
          ) : (
            <div className="text-muted">No description</div>
          )}
        </div>

        {/* Comments */}
        <div className="detail-section">
          <h4 className="detail-section-title">
            <MessageSquare className="w-4 h-4" /> Comments
            {comments.length > 0 && (
              <span className="badge badge-sm ml-2">{comments.length}</span>
            )}
          </h4>
          {loadingComments ? (
            <div className="text-muted">Loading comments...</div>
          ) : comments.length > 0 ? (
            <div className="comments-list">
              {comments.map((thread) => (
                <div key={thread.id} className="comment-thread">
                  {thread.threadContext?.filePath && (
                    <div className="comment-file-context">
                      <Code className="w-3 h-3" />
                      <span>{thread.threadContext.filePath}</span>
                      {thread.threadContext.rightFileStart && (
                        <span className="comment-line">
                          Line {thread.threadContext.rightFileStart.line}
                        </span>
                      )}
                    </div>
                  )}
                  {thread.comments.map((comment) => (
                    <div key={comment.id} className="comment-item">
                      <div className="comment-header">
                        <span className="comment-author">{comment.author.displayName}</span>
                        <span className="comment-date">
                          {new Date(comment.publishedDate).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div className="comment-content">
                        <Markdown content={comment.content || ""} />
                      </div>
                    </div>
                  ))}
                  <a
                    href={thread.webUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="comment-link"
                  >
                    View in Azure DevOps <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-muted">No comments yet</div>
          )}
        </div>

        {/* Local Notes */}
        <NotesEditor type="pr" id={String(pr.pullRequestId)} />
      </div>
    </div>
  );
}
