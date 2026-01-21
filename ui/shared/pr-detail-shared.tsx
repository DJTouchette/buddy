/**
 * Shared components, types, and hooks for PR detail views (modal and page)
 */
import React, { useState, useCallback } from "react";
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertCircle,
  ThumbsUp,
  ThumbsDown,
  MinusCircle,
  Loader2,
  ExternalLink,
  User,
} from "lucide-react";
import type { PRReviewer } from "../../services/azureDevOpsService";

// ============================================================================
// Types
// ============================================================================

export interface PRStatus {
  id: number;
  state: string;
  description: string;
  context: {
    name: string;
    genre: string;
  };
  targetUrl?: string;
}

export interface PRCheck {
  id: string;
  name: string;
  status: "approved" | "rejected" | "running" | "queued" | "notApplicable" | "broken";
  isBlocking: boolean;
  type: string;
  buildId?: number;
  buildUrl?: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

export function getApprovalStatus(reviewers?: PRReviewer[]): {
  status: "approved" | "rejected" | "pending" | "waiting";
  approvedCount: number;
  totalCount: number;
} {
  if (!reviewers || reviewers.length === 0) {
    return { status: "pending", approvedCount: 0, totalCount: 0 };
  }

  const individualReviewers = reviewers.filter((r) => !r.isContainer);
  const approvedCount = individualReviewers.filter((r) => r.vote >= 5).length;
  const rejectedCount = individualReviewers.filter((r) => r.vote === -10).length;
  const waitingCount = individualReviewers.filter((r) => r.vote === -5).length;

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

export function getVoteBadgeClass(vote: number): string {
  if (vote >= 10) return "badge-green";
  if (vote >= 5) return "badge-blue";
  if (vote === -5) return "badge-yellow";
  if (vote === -10) return "badge-red";
  return "badge-gray";
}

export function getVoteLabel(vote: number): string {
  if (vote >= 10) return "Approved";
  if (vote >= 5) return "Approved with suggestions";
  if (vote === -5) return "Waiting for author";
  if (vote === -10) return "Rejected";
  return "No vote";
}

// ============================================================================
// Shared Components
// ============================================================================

export function PRStatusBadge({ status }: { status: string }) {
  const badgeClass: Record<string, string> = {
    active: "badge-green",
    completed: "badge-blue",
    abandoned: "badge-gray",
  };

  return <span className={`badge ${badgeClass[status] || "badge-gray"}`}>{status}</span>;
}

export function StatusIcon({ state }: { state: string }) {
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

export function CheckStatusIcon({ status }: { status: PRCheck["status"] }) {
  switch (status) {
    case "approved":
      return <CheckCircle className="w-4 h-4 status-success" />;
    case "rejected":
    case "broken":
      return <XCircle className="w-4 h-4 status-error" />;
    case "running":
    case "queued":
      return <Clock className="w-4 h-4 status-pending" />;
    case "notApplicable":
      return <AlertCircle className="w-4 h-4 text-muted" />;
    default:
      return <Clock className="w-4 h-4 status-pending" />;
  }
}

export function ApprovalBadge({ reviewers }: { reviewers?: PRReviewer[] }) {
  const { status, approvedCount, totalCount } = getApprovalStatus(reviewers);

  if (totalCount === 0) {
    return null;
  }

  const statusConfig = {
    approved: { icon: ThumbsUp, className: "approval-approved", label: "Approved" },
    rejected: { icon: ThumbsDown, className: "approval-rejected", label: "Rejected" },
    waiting: { icon: Clock, className: "approval-waiting", label: "Changes requested" },
    pending: {
      icon: MinusCircle,
      className: "approval-pending",
      label: `${approvedCount}/${totalCount} approved`,
    },
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

export function DetailRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
}) {
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

export function ReviewerItem({ reviewer }: { reviewer: PRReviewer }) {
  return (
    <div className="reviewer-item">
      <User className="w-4 h-4" />
      <span className="reviewer-name">{reviewer.displayName}</span>
      <span className={`badge badge-sm ${getVoteBadgeClass(reviewer.vote)}`}>
        {getVoteLabel(reviewer.vote)}
      </span>
      {reviewer.isRequired && <span className="text-xs text-muted">(required)</span>}
    </div>
  );
}

export function StatusCheckItem({ check }: { check: PRCheck }) {
  return (
    <div className="status-item">
      <CheckStatusIcon status={check.status} />
      <div className="status-info">
        <div className="status-name">
          {check.buildUrl ? (
            <a
              href={check.buildUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="check-link"
            >
              {check.name}
              <ExternalLink className="w-3 h-3" />
            </a>
          ) : (
            check.name
          )}
          {check.isBlocking && <span className="text-muted text-xs ml-1">(required)</span>}
        </div>
        <div className="status-description">{check.type}</div>
      </div>
      <span
        className={`badge badge-${
          check.status === "approved"
            ? "green"
            : check.status === "rejected" || check.status === "broken"
            ? "red"
            : check.status === "running" || check.status === "queued"
            ? "yellow"
            : "gray"
        }`}
      >
        {check.status}
      </span>
    </div>
  );
}

export function CustomStatusItem({ status }: { status: PRStatus }) {
  return (
    <div className="status-item">
      <StatusIcon state={status.state} />
      <div className="status-info">
        <div className="status-name">{status.context.name}</div>
        <div className="status-description">{status.description}</div>
      </div>
      <span
        className={`badge badge-${
          status.state === "succeeded" ? "green" : status.state === "failed" ? "red" : "gray"
        }`}
      >
        {status.state}
      </span>
    </div>
  );
}

// ============================================================================
// Hooks
// ============================================================================

export function usePRCheckout(sourceBranch: string) {
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);

  const isCheckedOut = currentBranch === sourceBranch;

  const fetchCurrentBranch = useCallback(async () => {
    try {
      const res = await fetch("/api/git/current-branch");
      const data = await res.json();
      if (data.branch) {
        setCurrentBranch(data.branch);
      }
    } catch {
      // Ignore errors
    }
  }, []);

  const handleCheckout = useCallback(async () => {
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
    } catch {
      setCheckoutResult({
        success: false,
        message: "Failed to checkout branch",
      });
    } finally {
      setCheckoutLoading(false);
    }
  }, [sourceBranch]);

  return {
    checkoutLoading,
    checkoutResult,
    currentBranch,
    isCheckedOut,
    fetchCurrentBranch,
    handleCheckout,
    setCheckoutResult,
    setCurrentBranch,
  };
}

export function usePRDescription(prId: number, initialDescription: string) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedDescription, setEditedDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const startEditing = useCallback(() => {
    setEditedDescription(initialDescription || "");
    setIsEditing(true);
    setError(null);
  }, [initialDescription]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditedDescription("");
    setError(null);
  }, []);

  const saveDescription = useCallback(async (): Promise<string | null> => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/prs/${prId}/description`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: editedDescription }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setIsEditing(false);
        setEditedDescription("");
        return data.pr?.description || editedDescription;
      } else {
        setError(data.error || "Failed to save description");
        return null;
      }
    } catch {
      setError("Failed to save description");
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [prId, editedDescription]);

  return {
    isEditing,
    editedDescription,
    setEditedDescription,
    isSaving,
    error,
    expanded,
    setExpanded,
    startEditing,
    cancelEditing,
    saveDescription,
  };
}

export function usePRReviewers(prId: number) {
  const [isAddingReviewer, setIsAddingReviewer] = useState(false);
  const [isRemovingReviewer, setIsRemovingReviewer] = useState(false);

  const addSelfAsReviewer = useCallback(async (): Promise<PRReviewer[] | null> => {
    setIsAddingReviewer(true);

    try {
      const response = await fetch(`/api/prs/${prId}/reviewers/self`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (response.ok && data.success) {
        return data.pr?.reviewers || null;
      }
      return null;
    } catch {
      return null;
    } finally {
      setIsAddingReviewer(false);
    }
  }, [prId]);

  const removeSelfAsReviewer = useCallback(async (): Promise<PRReviewer[] | null> => {
    setIsRemovingReviewer(true);

    try {
      const response = await fetch(`/api/prs/${prId}/reviewers/self`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (response.ok && data.success) {
        return data.pr?.reviewers || null;
      }
      return null;
    } catch {
      return null;
    } finally {
      setIsRemovingReviewer(false);
    }
  }, [prId]);

  return {
    isAddingReviewer,
    isRemovingReviewer,
    addSelfAsReviewer,
    removeSelfAsReviewer,
  };
}

export function usePRStatuses(prId: number | undefined) {
  const [statuses, setStatuses] = useState<PRStatus[]>([]);
  const [checks, setChecks] = useState<PRCheck[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchStatuses = useCallback(async () => {
    if (!prId) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/prs/${prId}/statuses`);
      const data = await res.json();
      if (data.statuses) setStatuses(data.statuses);
      if (data.checks) setChecks(data.checks);
    } catch {
      // Ignore errors
    } finally {
      setLoading(false);
    }
  }, [prId]);

  return { statuses, checks, loading, fetchStatuses };
}
