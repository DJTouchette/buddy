import React, { useState } from "react";
import { ExternalLink, User, Calendar, Tag, AlertCircle, GitBranch, Layers, Maximize2, Minimize2, Paperclip, FileText, Image, File, Download, Loader2, Check, X, Expand } from "lucide-react";
import { Modal } from "./Modal";
import { JiraMarkdown } from "./JiraMarkdown";
import { NotesEditor } from "./NotesEditor";
import type { TicketWithPR } from "../../services/linkingService";
import type { JiraAttachment } from "../../services/jiraService";

interface TicketDetailModalProps {
  ticket: TicketWithPR | null;
  jiraHost: string;
  onClose: () => void;
  onTicketClick?: (ticketKey: string) => void;
  onPRClick?: (prId: number) => void;
  onOpenFullPage?: (ticketKey: string) => void;
}

function StatusBadge({ status }: { status: string }) {
  const badgeClass: Record<string, string> = {
    "Done": "badge-green",
    "In Progress": "badge-blue",
    "Code Review": "badge-purple",
    "To Do": "badge-gray",
    "Blocked": "badge-red",
  };

  return (
    <span className={`badge ${badgeClass[status] || "badge-gray"}`}>
      {status}
    </span>
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return Image;
  if (mimeType.includes("pdf") || mimeType.includes("document") || mimeType.includes("text")) return FileText;
  return File;
}

function AttachmentItem({ attachment }: { attachment: JiraAttachment }) {
  const isImage = attachment.mimeType.startsWith("image/");
  const FileIcon = getFileIcon(attachment.mimeType);

  // Use proxy URL for thumbnails to handle JIRA auth
  const thumbnailUrl = `/api/jira/thumbnail/${attachment.id}`;
  // Link to JIRA for opening the full attachment (uses JIRA's built-in viewer)
  const jiraAttachmentUrl = attachment.content;

  return (
    <a
      href={jiraAttachmentUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="attachment-item"
      title={`${attachment.filename} (${formatFileSize(attachment.size)})`}
    >
      {isImage ? (
        <div className="attachment-thumbnail">
          <img src={thumbnailUrl} alt={attachment.filename} />
        </div>
      ) : (
        <div className="attachment-icon">
          <FileIcon className="w-8 h-8" />
        </div>
      )}
      <div className="attachment-info">
        <span className="attachment-name">{attachment.filename}</span>
        <span className="attachment-meta">{formatFileSize(attachment.size)}</span>
      </div>
    </a>
  );
}

export function TicketDetailModal({ ticket, jiraHost, onClose, onTicketClick, onPRClick, onOpenFullPage }: TicketDetailModalProps) {
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState<{ success: boolean; message: string } | null>(null);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);

  // Fetch current branch and reset state when ticket changes
  React.useEffect(() => {
    setCheckoutResult(null);
    setShowBranchPicker(false);
    setDescriptionExpanded(false);
    setCurrentBranch(null);

    if (ticket?.key) {
      fetch("/api/git/current-branch")
        .then(res => res.json())
        .then(data => {
          if (data.branch) {
            setCurrentBranch(data.branch);
          }
        })
        .catch(() => {});
    }
  }, [ticket?.key]);

  if (!ticket) return null;

  // Check if current branch matches this ticket
  const isCheckedOut = currentBranch?.toUpperCase().startsWith(ticket.key.toUpperCase());

  const ticketUrl = `${jiraHost}/browse/${ticket.key}`;
  const created = ticket.fields.created ? new Date(ticket.fields.created).toLocaleDateString() : "N/A";
  const updated = ticket.fields.updated ? new Date(ticket.fields.updated).toLocaleDateString() : "N/A";

  const handleCheckout = async (baseBranch: string) => {
    setShowBranchPicker(false);
    setCheckoutLoading(true);
    setCheckoutResult(null);

    try {
      const response = await fetch("/api/git/checkout-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketKey: ticket.key,
          ticketTitle: ticket.fields.summary,
          baseBranch,
        }),
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
    <Modal isOpen={!!ticket} onClose={onClose} title={ticket.key} titleExtra={titleExtra}>
      <div className="ticket-detail">
        {/* Header with summary */}
        <div className="detail-header">
          <h3 className="detail-summary">{ticket.fields.summary}</h3>
          <div className="detail-header-actions">
            {!isCheckedOut && (
              <div className="checkout-button-wrapper">
                <button
                  className="btn-secondary"
                  onClick={() => setShowBranchPicker(!showBranchPicker)}
                  disabled={checkoutLoading}
                  title="Checkout branch for this ticket"
                >
                  {checkoutLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  Checkout
                </button>
                {showBranchPicker && (
                  <div className="branch-picker">
                    <div className="branch-picker-title">Branch from:</div>
                    <button onClick={() => handleCheckout("master")} className="branch-picker-option">
                      master
                    </button>
                    <button onClick={() => handleCheckout("nextrelease")} className="branch-picker-option">
                      nextrelease
                    </button>
                  </div>
                )}
              </div>
            )}
            {onOpenFullPage && (
              <button
                className="btn-secondary"
                onClick={() => onOpenFullPage(ticket.key)}
                title="Open in full page"
              >
                <Expand className="w-4 h-4" />
                Full Page
              </button>
            )}
            <a href={ticketUrl} target="_blank" rel="noopener noreferrer" className="btn-link">
              Open in JIRA <ExternalLink className="w-4 h-4" />
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

        {/* Status and Type */}
        <div className="detail-badges">
          <StatusBadge status={ticket.fields.status.name} />
          <span className="badge badge-gray">{ticket.fields.issuetype.name}</span>
          {ticket.fields.priority && (
            <span className="badge badge-gray">{ticket.fields.priority.name}</span>
          )}
        </div>

        {/* Details Grid */}
        <div className="detail-grid">
          <DetailRow icon={User} label="Assignee">
            {ticket.fields.assignee?.displayName || "Unassigned"}
          </DetailRow>

          <DetailRow icon={Calendar} label="Created">
            {created}
          </DetailRow>

          <DetailRow icon={Calendar} label="Updated">
            {updated}
          </DetailRow>

          <DetailRow icon={Tag} label="Type">
            {ticket.fields.issuetype.name}
          </DetailRow>

          {ticket.fields.priority && (
            <DetailRow icon={AlertCircle} label="Priority">
              {ticket.fields.priority.name}
            </DetailRow>
          )}

          {ticket.fields.parent && (
            <DetailRow icon={Layers} label="Parent">
              <button
                className="jira-ticket-link"
                onClick={() => onTicketClick?.(ticket.fields.parent!.key)}
              >
                {ticket.fields.parent.key}: {ticket.fields.parent.fields.summary}
              </button>
            </DetailRow>
          )}
        </div>

        {/* Linked PR */}
        {ticket.linkedPR && (
          <div className="detail-section">
            <h4 className="detail-section-title">
              <GitBranch className="w-4 h-4" /> Linked Pull Request
            </h4>
            <div
              className="detail-card clickable-card"
              onClick={() => onPRClick?.(ticket.linkedPR!.pullRequestId)}
            >
              <div className="detail-card-header">
                <button className="jira-ticket-link">
                  PR #{ticket.linkedPR.pullRequestId}: {ticket.linkedPR.title}
                </button>
              </div>
              <div className="detail-card-meta">
                <span className={`badge ${ticket.linkedPR.status === "active" ? "badge-green" : "badge-gray"}`}>
                  {ticket.linkedPR.status}
                </span>
                <span className="text-muted">
                  {ticket.linkedPR.sourceRefName.replace("refs/heads/", "")} → {ticket.linkedPR.targetRefName.replace("refs/heads/", "")}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Subtasks */}
        {ticket.fields.subtasks && ticket.fields.subtasks.length > 0 && (
          <div className="detail-section">
            <h4 className="detail-section-title">
              <Layers className="w-4 h-4" /> Subtasks ({ticket.fields.subtasks.length})
            </h4>
            <div className="subtask-list">
              {ticket.fields.subtasks.map((subtask) => (
                <div key={subtask.key} className="subtask-item">
                  <button
                    className="jira-ticket-link"
                    onClick={() => onTicketClick?.(subtask.key)}
                  >
                    {subtask.key}
                  </button>
                  <span className="subtask-summary">{subtask.fields.summary}</span>
                  <StatusBadge status={subtask.fields.status.name} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Attachments */}
        {ticket.fields.attachment && ticket.fields.attachment.length > 0 && (
          <div className="detail-section">
            <h4 className="detail-section-title">
              <Paperclip className="w-4 h-4" /> Attachments ({ticket.fields.attachment.length})
            </h4>
            <div className="attachment-grid">
              {ticket.fields.attachment.map((att) => (
                <AttachmentItem key={att.id} attachment={att} />
              ))}
            </div>
          </div>
        )}

        {/* Description */}
        {ticket.fields.description && (
          <div className="detail-section">
            <div className="detail-section-header">
              <h4 className="detail-section-title">Description</h4>
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
            </div>
            <div className={`detail-description ${descriptionExpanded ? "expanded" : ""}`}>
              <JiraMarkdown content={ticket.fields.description} onTicketClick={onTicketClick} />
            </div>
          </div>
        )}

        {/* Local Notes */}
        <NotesEditor type="ticket" id={ticket.key} />
      </div>
    </Modal>
  );
}
