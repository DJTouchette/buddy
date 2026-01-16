import React, { useState, useEffect, useRef } from "react";
import { ExternalLink, User, Calendar, Tag, AlertCircle, GitBranch, Layers, Maximize2, Minimize2, Paperclip, FileText, Image, File, Download, Loader2, Check, X, Expand, ChevronLeft, ChevronRight, Pencil, Save } from "lucide-react";
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
  onTicketUpdate?: (updatedTicket: TicketWithPR) => void;
}

function StatusBadge({ status }: { status: string }) {
  // Match workflow colors
  const statusLower = status.toLowerCase();
  let badgeClass = "badge-gray";

  if (statusLower === "to do") badgeClass = "badge-status-gray";
  else if (statusLower === "in progress") badgeClass = "badge-status-blue";
  else if (statusLower === "code review") badgeClass = "badge-status-purple";
  else if (statusLower.includes("pre-review") || statusLower.includes("merge")) badgeClass = "badge-status-indigo";
  else if (statusLower === "qa (feature)" || statusLower === "qa feature") badgeClass = "badge-status-orange";
  else if (statusLower === "qa (final)" || statusLower === "qa final") badgeClass = "badge-status-amber";
  else if (statusLower === "po review") badgeClass = "badge-status-teal";
  else if (statusLower === "done") badgeClass = "badge-status-green";
  else if (statusLower === "blocked") badgeClass = "badge-status-red";

  return (
    <span className={`badge ${badgeClass}`}>
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

interface JiraTransition {
  id: string;
  name: string;
  to: {
    name: string;
  };
}

interface WorkflowStatusBarProps {
  currentStatus: string;
  workflowStatuses: string[];
  availableTransitions: JiraTransition[];
  onTransition: (statusName: string) => void;
  isTransitioning: boolean;
}

// Color classes for workflow steps (cycles through if more steps than colors)
const WORKFLOW_COLORS = [
  "workflow-color-gray",    // To Do
  "workflow-color-blue",    // In Progress
  "workflow-color-purple",  // Code Review
  "workflow-color-indigo",  // Pre-Review
  "workflow-color-orange",  // QA Feature
  "workflow-color-amber",   // QA Final
  "workflow-color-teal",    // PO Review
  "workflow-color-green",   // Done
];

function WorkflowStatusBar({ currentStatus, workflowStatuses, availableTransitions, onTransition, isTransitioning }: WorkflowStatusBarProps) {
  const currentIndex = workflowStatuses.findIndex(
    (s) => s.toLowerCase() === currentStatus.toLowerCase()
  );
  const stepsRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Scroll active step into view
  useEffect(() => {
    if (activeRef.current && stepsRef.current) {
      activeRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "center",
      });
    }
  }, [currentIndex]);

  // Get available next/previous statuses from transitions
  const availableStatusNames = availableTransitions.map((t) => t.to.name.toLowerCase());

  const canGoBack = currentIndex > 0 && availableStatusNames.includes(workflowStatuses[currentIndex - 1].toLowerCase());
  const canGoForward = currentIndex < workflowStatuses.length - 1 && availableStatusNames.includes(workflowStatuses[currentIndex + 1].toLowerCase());

  const prevStatus = currentIndex > 0 ? workflowStatuses[currentIndex - 1] : null;
  const nextStatus = currentIndex < workflowStatuses.length - 1 ? workflowStatuses[currentIndex + 1] : null;

  return (
    <div className="workflow-status-bar">
      <button
        className="btn-icon workflow-nav-btn"
        onClick={() => prevStatus && onTransition(prevStatus)}
        disabled={!canGoBack || isTransitioning}
        title={prevStatus ? `Move to ${prevStatus}` : ""}
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      <div className="workflow-steps" ref={stepsRef}>
        {workflowStatuses.map((status, index) => {
          const isActive = index === currentIndex;
          const isPast = index < currentIndex;
          const isAvailable = availableStatusNames.includes(status.toLowerCase());
          const colorClass = WORKFLOW_COLORS[index % WORKFLOW_COLORS.length];

          return (
            <button
              key={status}
              ref={isActive ? activeRef : null}
              className={`workflow-step ${isActive ? "active" : ""} ${isPast ? "past" : ""} ${isAvailable && !isActive ? "available" : ""} ${colorClass}`}
              onClick={() => isAvailable && !isActive && onTransition(status)}
              disabled={!isAvailable || isActive || isTransitioning}
              title={status}
            >
              <span className="workflow-step-dot" />
              <span className="workflow-step-label">{status}</span>
            </button>
          );
        })}
      </div>

      <button
        className="btn-icon workflow-nav-btn"
        onClick={() => nextStatus && onTransition(nextStatus)}
        disabled={!canGoForward || isTransitioning}
        title={nextStatus ? `Move to ${nextStatus}` : ""}
      >
        <ChevronRight className="w-4 h-4" />
      </button>

      {isTransitioning && (
        <div className="workflow-loading">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      )}
    </div>
  );
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

export function TicketDetailModal({ ticket, jiraHost, onClose, onTicketClick, onPRClick, onOpenFullPage, onTicketUpdate }: TicketDetailModalProps) {
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState<{ success: boolean; message: string } | null>(null);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [existingBranch, setExistingBranch] = useState<string | null>(null);

  // Workflow transition state
  const [transitions, setTransitions] = useState<JiraTransition[]>([]);
  const [workflowStatuses, setWorkflowStatuses] = useState<string[]>([]);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  // Description editing state
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editedDescription, setEditedDescription] = useState("");
  const [isSavingDescription, setIsSavingDescription] = useState(false);
  const [descriptionError, setDescriptionError] = useState<string | null>(null);

  // Fetch transitions and workflow when ticket changes
  useEffect(() => {
    if (!ticket?.key) {
      setTransitions([]);
      setWorkflowStatuses([]);
      return;
    }

    fetch(`/api/jira/tickets/${ticket.key}/transitions`)
      .then((res) => res.json())
      .then((data) => {
        setTransitions(data.transitions || []);
        setWorkflowStatuses(data.workflowStatuses || []);
      })
      .catch(() => {
        setTransitions([]);
        setWorkflowStatuses([]);
      });
  }, [ticket?.key, ticket?.fields.status.name]);

  const handleTransition = async (statusName: string) => {
    if (!ticket) return;

    setIsTransitioning(true);
    setTransitionError(null);

    try {
      const response = await fetch(`/api/jira/tickets/${ticket.key}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusName }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Update the ticket with new status
        if (data.issue && onTicketUpdate) {
          onTicketUpdate({
            ...ticket,
            fields: {
              ...ticket.fields,
              status: data.issue.fields.status,
            },
          });
        }
        // Refresh transitions for new status
        const transRes = await fetch(`/api/jira/tickets/${ticket.key}/transitions`);
        const transData = await transRes.json();
        setTransitions(transData.transitions || []);
      } else {
        setTransitionError(data.error || "Failed to transition ticket");
      }
    } catch (err) {
      setTransitionError("Failed to transition ticket");
    } finally {
      setIsTransitioning(false);
    }
  };

  // Fetch current branch and check for existing branch when ticket changes
  useEffect(() => {
    setCheckoutResult(null);
    setShowBranchPicker(false);
    setDescriptionExpanded(false);
    setCurrentBranch(null);
    setExistingBranch(null);
    setTransitionError(null);
    setIsEditingDescription(false);
    setDescriptionError(null);

    if (ticket?.key) {
      // Fetch current branch
      fetch("/api/git/current-branch")
        .then(res => res.json())
        .then(data => {
          if (data.branch) {
            setCurrentBranch(data.branch);
          }
        })
        .catch(() => {});

      // Check for existing branch: first from linked PR, then from local git
      if (ticket.linkedPR) {
        // Use PR source branch
        const prBranch = ticket.linkedPR.sourceRefName.replace("refs/heads/", "");
        setExistingBranch(prBranch);
      } else {
        // Check for local branch matching ticket key
        fetch(`/api/git/ticket-branch/${ticket.key}`)
          .then(res => res.json())
          .then(data => {
            if (data.branch) {
              setExistingBranch(data.branch);
            }
          })
          .catch(() => {});
      }
    }
  }, [ticket?.key, ticket?.linkedPR]);

  // Helper to convert ADF to markdown for editing
  const adfToMarkdown = (adf: any): string => {
    if (!adf || typeof adf === "string") return adf || "";
    if (!adf.content) return "";

    const extractText = (node: any, listDepth = 0): string => {
      if (node.type === "text") {
        let text = node.text || "";
        // Apply marks (bold, italic, code, etc.)
        if (node.marks) {
          for (const mark of node.marks) {
            if (mark.type === "strong") text = `**${text}**`;
            else if (mark.type === "em") text = `*${text}*`;
            else if (mark.type === "code") text = `\`${text}\``;
            else if (mark.type === "strike") text = `~~${text}~~`;
            else if (mark.type === "link") text = `[${text}](${mark.attrs?.href || ""})`;
          }
        }
        return text;
      }
      if (node.type === "hardBreak") return "\n";
      if (node.type === "paragraph") {
        const text = (node.content || []).map((n: any) => extractText(n, listDepth)).join("");
        return text + "\n\n";
      }
      if (node.type === "heading") {
        const level = node.attrs?.level || 1;
        const text = (node.content || []).map((n: any) => extractText(n, listDepth)).join("");
        return "#".repeat(level) + " " + text + "\n\n";
      }
      if (node.type === "bulletList") {
        return (node.content || []).map((n: any) => extractText(n, listDepth)).join("") + "\n";
      }
      if (node.type === "orderedList") {
        return (node.content || []).map((n: any, i: number) => extractText({ ...n, _orderedIndex: i + 1 }, listDepth)).join("") + "\n";
      }
      if (node.type === "listItem") {
        const indent = "  ".repeat(listDepth);
        const bullet = node._orderedIndex ? `${node._orderedIndex}.` : "*";
        const text = (node.content || []).map((n: any) => extractText(n, listDepth + 1)).join("").trim();
        return `${indent}${bullet} ${text}\n`;
      }
      if (node.type === "codeBlock") {
        const lang = node.attrs?.language || "";
        const text = (node.content || []).map((n: any) => extractText(n, listDepth)).join("");
        return "```" + lang + "\n" + text + "```\n\n";
      }
      if (node.type === "blockquote") {
        const text = (node.content || []).map((n: any) => extractText(n, listDepth)).join("");
        return text.split("\n").map((line: string) => line ? `> ${line}` : ">").join("\n") + "\n";
      }
      if (node.type === "rule") {
        return "---\n\n";
      }
      if (node.content) {
        return node.content.map((n: any) => extractText(n, listDepth)).join("");
      }
      return "";
    };

    return adf.content.map((n: any) => extractText(n)).join("").trim();
  };

  const handleEditDescription = () => {
    const markdown = adfToMarkdown(ticket?.fields.description);
    setEditedDescription(markdown);
    setIsEditingDescription(true);
    setDescriptionError(null);
  };

  const handleCancelEdit = () => {
    setIsEditingDescription(false);
    setEditedDescription("");
    setDescriptionError(null);
  };

  const handleSaveDescription = async () => {
    if (!ticket) return;

    setIsSavingDescription(true);
    setDescriptionError(null);

    try {
      const response = await fetch(`/api/jira/tickets/${ticket.key}/description`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: editedDescription }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        // Update the ticket with new description
        if (data.issue && onTicketUpdate) {
          onTicketUpdate({
            ...ticket,
            fields: {
              ...ticket.fields,
              description: data.issue.fields.description,
            },
          });
        }
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

  if (!ticket) return null;

  // Check if current branch matches this ticket
  const isCheckedOut = currentBranch?.toUpperCase().startsWith(ticket.key.toUpperCase());

  // Ensure JIRA URL has protocol
  const jiraBaseUrl = jiraHost.startsWith("http") ? jiraHost : `https://${jiraHost}`;
  const ticketUrl = `${jiraBaseUrl}/browse/${ticket.key}`;
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

  // Checkout existing branch (from PR or local git)
  const handleCheckoutExisting = async () => {
    if (!existingBranch) return;

    setCheckoutLoading(true);
    setCheckoutResult(null);

    try {
      const response = await fetch("/api/git/checkout-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchName: existingBranch,
        }),
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
                {existingBranch ? (
                  // Existing branch found - checkout directly
                  <button
                    className="btn-secondary"
                    onClick={handleCheckoutExisting}
                    disabled={checkoutLoading}
                    title={`Checkout ${existingBranch}`}
                  >
                    {checkoutLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    Checkout {existingBranch}
                  </button>
                ) : (
                  // No existing branch - show branch picker
                  <>
                    <button
                      className="btn-secondary"
                      onClick={() => setShowBranchPicker(!showBranchPicker)}
                      disabled={checkoutLoading}
                      title="Create new branch for this ticket"
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
                  </>
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

        {/* Workflow Status Bar */}
        {workflowStatuses.length > 0 && (
          <div className="workflow-section">
            <WorkflowStatusBar
              currentStatus={ticket.fields.status.name}
              workflowStatuses={workflowStatuses}
              availableTransitions={transitions}
              onTransition={handleTransition}
              isTransitioning={isTransitioning}
            />
            {transitionError && (
              <div className="transition-error">
                <AlertCircle className="w-4 h-4" />
                {transitionError}
              </div>
            )}
          </div>
        )}

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
        <div className="detail-section">
          <div className="detail-section-header">
            <h4 className="detail-section-title">Description</h4>
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
                  {ticket.fields.description && (
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
                placeholder="Enter description..."
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
          ) : ticket.fields.description ? (
            <div className={`detail-description ${descriptionExpanded ? "expanded" : ""}`}>
              <JiraMarkdown content={ticket.fields.description} onTicketClick={onTicketClick} />
            </div>
          ) : (
            <div className="text-muted">No description</div>
          )}
        </div>

        {/* Local Notes */}
        <NotesEditor type="ticket" id={ticket.key} />
      </div>
    </Modal>
  );
}
