import React, { useEffect, useState } from "react";
import { ExternalLink, GitBranch, GitMerge, User, FileText, CheckCircle, XCircle, Clock, Ticket, Download, Loader2, Check, X, Expand } from "lucide-react";
import { Modal } from "./Modal";
import { NotesEditor } from "./NotesEditor";
import type { PRWithTicket } from "../../services/linkingService";

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

interface PRDetailModalProps {
  pr: PRWithTicket | null;
  jiraHost: string;
  onClose: () => void;
  onTicketClick?: (ticketKey: string) => void;
  onOpenFullPage?: (prId: number) => void;
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

export function PRDetailModal({ pr, jiraHost, onClose, onTicketClick, onOpenFullPage }: PRDetailModalProps) {
  const [statuses, setStatuses] = useState<PRStatus[]>([]);
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState<{ success: boolean; message: string } | null>(null);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);

  useEffect(() => {
    if (pr) {
      setLoadingStatuses(true);
      setCheckoutResult(null);
      setCurrentBranch(null);

      // Fetch PR statuses
      fetch(`/api/prs/${pr.pullRequestId}/statuses`)
        .then((res) => res.json())
        .then((data) => {
          if (data.statuses) {
            setStatuses(data.statuses);
          }
        })
        .catch(() => {})
        .finally(() => {
          setLoadingStatuses(false);
        });

      // Fetch current branch
      fetch("/api/git/current-branch")
        .then(res => res.json())
        .then(data => {
          if (data.branch) {
            setCurrentBranch(data.branch);
          }
        })
        .catch(() => {});
    }
  }, [pr?.pullRequestId]);

  if (!pr) return null;

  const sourceBranch = pr.sourceRefName.replace("refs/heads/", "");
  const targetBranch = pr.targetRefName.replace("refs/heads/", "");

  // Check if current branch matches this PR's source branch
  const isCheckedOut = currentBranch === sourceBranch;

  const handleCheckout = async () => {
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
        // Update current branch so badge shows immediately
        setCurrentBranch(data.branchName);
        // Auto-dismiss success message after 5 seconds
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

  const titleExtra = isCheckedOut ? (
    <div className="checked-out-badge">
      <Check className="w-4 h-4" />
      <span>Checked out</span>
    </div>
  ) : null;

  return (
    <Modal isOpen={!!pr} onClose={onClose} title={`PR #${pr.pullRequestId}`} titleExtra={titleExtra}>
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
            {onOpenFullPage && (
              <button
                className="btn-secondary"
                onClick={() => onOpenFullPage(pr.pullRequestId)}
                title="Open in full page"
              >
                <Expand className="w-4 h-4" />
                Full Page
              </button>
            )}
            <a href={pr.url} target="_blank" rel="noopener noreferrer" className="btn-link">
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

        {/* Linked Ticket */}
        {pr.linkedTicket && (
          <div className="detail-section">
            <h4 className="detail-section-title">
              <Ticket className="w-4 h-4" /> Linked JIRA Ticket
            </h4>
            <div className="detail-card clickable-card" onClick={() => onTicketClick?.(pr.linkedTicket!.key)}>
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
            <CheckCircle className="w-4 h-4" /> Status Checks
          </h4>
          {loadingStatuses ? (
            <div className="text-muted">Loading status checks...</div>
          ) : statuses.length > 0 ? (
            <div className="status-list">
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
        {pr.description && (
          <div className="detail-section">
            <h4 className="detail-section-title">
              <FileText className="w-4 h-4" /> Description
            </h4>
            <div className="detail-description">{pr.description}</div>
          </div>
        )}

        {/* Local Notes */}
        <NotesEditor type="pr" id={String(pr.pullRequestId)} />
      </div>
    </Modal>
  );
}
