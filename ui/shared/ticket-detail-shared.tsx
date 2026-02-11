/**
 * Shared components, types, and hooks for Ticket detail views (modal and page)
 */
import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Download,
  FileText,
  Image,
  File,
  Play,
} from "lucide-react";
import type { JiraAttachment } from "../../services/jiraService";

// ============================================================================
// Types
// ============================================================================

export interface JiraTransition {
  id: string;
  name: string;
  to: {
    name: string;
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return Image;
  if (mimeType.startsWith("video/")) return Play;
  if (mimeType.includes("pdf") || mimeType.includes("document") || mimeType.includes("text"))
    return FileText;
  return File;
}

export function getStatusBadgeClass(status: string): string {
  const statusLower = status.toLowerCase();

  if (statusLower === "to do") return "badge-status-gray";
  if (statusLower === "in progress") return "badge-status-blue";
  if (statusLower === "code review") return "badge-status-purple";
  if (statusLower.includes("pre-review") || statusLower.includes("merge"))
    return "badge-status-indigo";
  if (statusLower === "qa (feature)" || statusLower === "qa feature") return "badge-status-orange";
  if (statusLower === "qa (final)" || statusLower === "qa final") return "badge-status-amber";
  if (statusLower === "po review") return "badge-status-teal";
  if (statusLower === "done") return "badge-status-green";
  if (statusLower === "blocked") return "badge-status-red";

  return "badge-gray";
}

/**
 * Convert JIRA ADF (Atlassian Document Format) to markdown for editing
 */
export function adfToMarkdown(adf: any): string {
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
      return (
        (node.content || [])
          .map((n: any, i: number) => extractText({ ...n, _orderedIndex: i + 1 }, listDepth))
          .join("") + "\n"
      );
    }
    if (node.type === "listItem") {
      const indent = "  ".repeat(listDepth);
      const bullet = node._orderedIndex ? `${node._orderedIndex}.` : "*";
      const text = (node.content || [])
        .map((n: any) => extractText(n, listDepth + 1))
        .join("")
        .trim();
      return `${indent}${bullet} ${text}\n`;
    }
    if (node.type === "codeBlock") {
      const lang = node.attrs?.language || "";
      const text = (node.content || []).map((n: any) => extractText(n, listDepth)).join("");
      return "```" + lang + "\n" + text + "```\n\n";
    }
    if (node.type === "blockquote") {
      const text = (node.content || []).map((n: any) => extractText(n, listDepth)).join("");
      return (
        text
          .split("\n")
          .map((line: string) => (line ? `> ${line}` : ">"))
          .join("\n") + "\n"
      );
    }
    if (node.type === "rule") {
      return "---\n\n";
    }
    if (node.content) {
      return node.content.map((n: any) => extractText(n, listDepth)).join("");
    }
    return "";
  };

  return adf.content
    .map((n: any) => extractText(n))
    .join("")
    .trim();
}

// ============================================================================
// Shared Components
// ============================================================================

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${getStatusBadgeClass(status)}`}>{status}</span>;
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

interface AttachmentItemProps {
  attachment: JiraAttachment;
  onPreview?: (attachment: JiraAttachment) => void;
}

export function AttachmentItem({ attachment, onPreview }: AttachmentItemProps) {
  const isImage = attachment.mimeType.startsWith("image/");
  const isVideo = attachment.mimeType.startsWith("video/");
  const FileIcon = getFileIcon(attachment.mimeType);
  const thumbnailUrl = `/api/jira/thumbnail/${attachment.id}`;
  const viewUrl = `/api/jira/attachment/${attachment.id}`;

  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const link = document.createElement("a");
    link.href = viewUrl;
    link.download = attachment.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    if (onPreview) {
      onPreview(attachment);
    } else {
      // Fallback to opening in new tab if no preview handler
      window.open(viewUrl, "_blank");
    }
  };

  return (
    <div className="attachment-item-wrapper">
      <button
        onClick={handleClick}
        className="attachment-item"
        title={`Preview ${attachment.filename} (${formatFileSize(attachment.size)})`}
      >
        {isImage ? (
          <div className="attachment-thumbnail">
            <img src={thumbnailUrl} alt={attachment.filename} />
          </div>
        ) : isVideo ? (
          <div className="attachment-thumbnail video-thumbnail">
            <Play className="w-8 h-8" />
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
      </button>
      <button
        className="attachment-download-btn"
        onClick={handleDownload}
        title={`Download ${attachment.filename}`}
      >
        <Download className="w-4 h-4" />
      </button>
    </div>
  );
}

// Color classes for workflow steps (cycles through if more steps than colors)
const WORKFLOW_COLORS = [
  "workflow-color-gray", // To Do
  "workflow-color-blue", // In Progress
  "workflow-color-purple", // Code Review
  "workflow-color-indigo", // Pre-Review
  "workflow-color-orange", // QA Feature
  "workflow-color-amber", // QA Final
  "workflow-color-teal", // PO Review
  "workflow-color-green", // Done
];

interface WorkflowStatusBarProps {
  currentStatus: string;
  workflowStatuses: string[];
  availableTransitions: JiraTransition[];
  onTransition: (statusName: string) => void;
  isTransitioning: boolean;
}

export function WorkflowStatusBar({
  currentStatus,
  workflowStatuses,
  availableTransitions,
  onTransition,
  isTransitioning,
}: WorkflowStatusBarProps) {
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

  const availableStatusNames = availableTransitions.map((t) => t.to.name.toLowerCase());

  const canGoBack =
    currentIndex > 0 &&
    availableStatusNames.includes(workflowStatuses[currentIndex - 1].toLowerCase());
  const canGoForward =
    currentIndex < workflowStatuses.length - 1 &&
    availableStatusNames.includes(workflowStatuses[currentIndex + 1].toLowerCase());

  const prevStatus = currentIndex > 0 ? workflowStatuses[currentIndex - 1] : null;
  const nextStatus =
    currentIndex < workflowStatuses.length - 1 ? workflowStatuses[currentIndex + 1] : null;

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
              className={`workflow-step ${isActive ? "active" : ""} ${isPast ? "past" : ""} ${
                isAvailable && !isActive ? "available" : ""
              } ${colorClass}`}
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

// ============================================================================
// Hooks
// ============================================================================

export function useTicketCheckout(ticketKey: string, linkedPRBranch?: string) {
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutResult, setCheckoutResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const [existingBranch, setExistingBranch] = useState<string | null>(null);
  const [showBranchPicker, setShowBranchPicker] = useState(false);

  const isCheckedOut = currentBranch?.toUpperCase().startsWith(ticketKey.toUpperCase());

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

  const checkForExistingBranch = useCallback(async () => {
    if (linkedPRBranch) {
      setExistingBranch(linkedPRBranch);
    } else {
      try {
        const res = await fetch(`/api/git/ticket-branch/${ticketKey}`);
        const data = await res.json();
        if (data.branch) {
          setExistingBranch(data.branch);
        }
      } catch {
        // Ignore errors
      }
    }
  }, [ticketKey, linkedPRBranch]);

  const handleCheckout = useCallback(
    async (baseBranch: string, ticketTitle: string) => {
      setShowBranchPicker(false);
      setCheckoutLoading(true);
      setCheckoutResult(null);

      try {
        const response = await fetch("/api/git/checkout-ticket", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ticketKey,
            ticketTitle,
            baseBranch,
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
      } catch {
        setCheckoutResult({
          success: false,
          message: "Failed to checkout branch",
        });
      } finally {
        setCheckoutLoading(false);
      }
    },
    [ticketKey]
  );

  const handleCheckoutExisting = useCallback(async () => {
    if (!existingBranch) return;

    setCheckoutLoading(true);
    setCheckoutResult(null);

    try {
      const response = await fetch("/api/git/checkout-pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchName: existingBranch }),
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
  }, [existingBranch]);

  return {
    checkoutLoading,
    checkoutResult,
    currentBranch,
    existingBranch,
    showBranchPicker,
    isCheckedOut,
    setShowBranchPicker,
    setCheckoutResult,
    setCurrentBranch,
    setExistingBranch,
    fetchCurrentBranch,
    checkForExistingBranch,
    handleCheckout,
    handleCheckoutExisting,
  };
}

export function useTicketTransitions(ticketKey: string | undefined) {
  const [transitions, setTransitions] = useState<JiraTransition[]>([]);
  const [workflowStatuses, setWorkflowStatuses] = useState<string[]>([]);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const fetchTransitions = useCallback(async () => {
    if (!ticketKey) {
      setTransitions([]);
      setWorkflowStatuses([]);
      return;
    }

    try {
      const res = await fetch(`/api/jira/tickets/${ticketKey}/transitions`);
      const data = await res.json();
      setTransitions(data.transitions || []);
      setWorkflowStatuses(data.workflowStatuses || []);
    } catch {
      setTransitions([]);
      setWorkflowStatuses([]);
    }
  }, [ticketKey]);

  const handleTransition = useCallback(
    async (statusName: string): Promise<any | null> => {
      if (!ticketKey) return null;

      setIsTransitioning(true);
      setTransitionError(null);

      try {
        const response = await fetch(`/api/jira/tickets/${ticketKey}/transition`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statusName }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          // Refresh transitions for new status
          await fetchTransitions();
          return data.issue;
        } else {
          setTransitionError(data.error || "Failed to transition ticket");
          return null;
        }
      } catch {
        setTransitionError("Failed to transition ticket");
        return null;
      } finally {
        setIsTransitioning(false);
      }
    },
    [ticketKey, fetchTransitions]
  );

  return {
    transitions,
    workflowStatuses,
    isTransitioning,
    transitionError,
    setTransitionError,
    fetchTransitions,
    handleTransition,
  };
}

export function useTicketAssignment(ticketKey: string | undefined) {
  const [isAssigning, setIsAssigning] = useState(false);

  const assignToSelf = useCallback(async (): Promise<any | null> => {
    if (!ticketKey) return null;

    setIsAssigning(true);

    try {
      const response = await fetch(`/api/jira/tickets/${ticketKey}/assign-self`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (response.ok && data.success) {
        return data.issue;
      }
      return null;
    } catch {
      return null;
    } finally {
      setIsAssigning(false);
    }
  }, [ticketKey]);

  const unassign = useCallback(async (): Promise<any | null> => {
    if (!ticketKey) return null;

    setIsAssigning(true);

    try {
      const response = await fetch(`/api/jira/tickets/${ticketKey}/unassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

      if (response.ok && data.success) {
        return data.issue;
      }
      return null;
    } catch {
      return null;
    } finally {
      setIsAssigning(false);
    }
  }, [ticketKey]);

  return {
    isAssigning,
    assignToSelf,
    unassign,
  };
}

export function useTicketDescription(ticketKey: string | undefined, initialDescription: any) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedDescription, setEditedDescription] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const startEditing = useCallback(() => {
    const markdown = adfToMarkdown(initialDescription);
    setEditedDescription(markdown);
    setIsEditing(true);
    setError(null);
  }, [initialDescription]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
    setEditedDescription("");
    setError(null);
  }, []);

  const saveDescription = useCallback(async (): Promise<any | null> => {
    if (!ticketKey) return null;

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/jira/tickets/${ticketKey}/description`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: editedDescription }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setIsEditing(false);
        setEditedDescription("");
        return data.issue;
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
  }, [ticketKey, editedDescription]);

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
