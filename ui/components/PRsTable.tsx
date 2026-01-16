import React from "react";
import { ChevronUp, ChevronDown, ThumbsUp, ThumbsDown, Clock, MinusCircle } from "lucide-react";
import type { PRWithTicket } from "../../services/linkingService";
import type { PRReviewer } from "../../services/azureDevOpsService";

export type PRSortField = "id" | "title" | "source" | "target" | "status" | "author";
type SortDirection = "asc" | "desc";

interface PRsTableProps {
  prs: PRWithTicket[];
  sortField: PRSortField;
  sortDirection: SortDirection;
  onSort: (field: PRSortField) => void;
  onRowClick: (pr: PRWithTicket) => void;
  navigate: (path: string) => void;
  onNavigateToPR?: (prId: number) => void;
  highlightedPR?: number | null;
}

function SortIcon({ field, currentField, direction }: { field: PRSortField; currentField: PRSortField; direction: SortDirection }) {
  if (field !== currentField) return null;
  return direction === "asc" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />;
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
    return <span className="text-muted text-xs">-</span>;
  }

  const statusConfig = {
    approved: { icon: ThumbsUp, className: "approval-approved", label: "Approved" },
    rejected: { icon: ThumbsDown, className: "approval-rejected", label: "Rejected" },
    waiting: { icon: Clock, className: "approval-waiting", label: "Changes" },
    pending: { icon: MinusCircle, className: "approval-pending", label: `${approvedCount}/${totalCount}` },
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

export function PRsTable({ prs, sortField, sortDirection, onSort, onRowClick, navigate, onNavigateToPR, highlightedPR }: PRsTableProps) {
  const columns: { key: PRSortField; label: string; width?: string }[] = [
    { key: "id", label: "ID", width: "w-20" },
    { key: "title", label: "Title" },
    { key: "source", label: "Source", width: "w-48" },
    { key: "target", label: "Target", width: "w-32" },
    { key: "author", label: "Author", width: "w-36" },
  ];

  // Non-sortable columns
  const extraColumns = [
    { key: "approval", label: "Approval", width: "w-28" },
  ];

  const handlePRLinkClick = (e: React.MouseEvent, prId: number) => {
    e.stopPropagation();
    if (onNavigateToPR) {
      onNavigateToPR(prId);
    } else {
      navigate(`/prs/${prId}`);
    }
  };

  const handleTicketLinkClick = (e: React.MouseEvent, ticketKey: string, prId: number) => {
    e.stopPropagation();
    // Set highlight so when user comes back, this PR row is highlighted
    sessionStorage.setItem("highlightPR", String(prId));
    navigate(`/tickets/${ticketKey}`);
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={col.width}
                onClick={() => onSort(col.key)}
              >
                <div className="flex items-center gap-1">
                  {col.label}
                  <SortIcon field={col.key} currentField={sortField} direction={sortDirection} />
                </div>
              </th>
            ))}
            {extraColumns.map((col) => (
              <th key={col.key} className={col.width}>
                {col.label}
              </th>
            ))}
            <th className="w-40">Linked Ticket</th>
          </tr>
        </thead>
        <tbody>
          {prs.map((pr) => (
            <tr
              key={pr.pullRequestId}
              data-pr-id={pr.pullRequestId}
              onClick={() => onRowClick(pr)}
              className={`clickable-row ${highlightedPR === pr.pullRequestId ? "highlighted-row" : ""}`}
            >
              <td>
                <button
                  className="jira-ticket-link"
                  onClick={(e) => handlePRLinkClick(e, pr.pullRequestId)}
                >
                  #{pr.pullRequestId}
                </button>
              </td>
              <td className="text-sm">{pr.title}</td>
              <td className="text-sm font-mono text-xs">
                {pr.sourceRefName.replace("refs/heads/", "")}
              </td>
              <td className="text-sm font-mono text-xs">
                {pr.targetRefName.replace("refs/heads/", "")}
              </td>
              <td className="text-sm text-muted">
                {pr.createdBy.displayName}
              </td>
              <td>
                <ApprovalBadge reviewers={pr.reviewers} />
              </td>
              <td>
                {pr.linkedTicket ? (
                  <button
                    className="jira-ticket-link text-sm"
                    onClick={(e) => handleTicketLinkClick(e, pr.linkedTicket!.key, pr.pullRequestId)}
                  >
                    {pr.linkedTicket.key}
                  </button>
                ) : (
                  <span className="text-sm text-muted">-</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {prs.length === 0 && (
        <div className="text-center py-8 text-muted">No pull requests found</div>
      )}
    </div>
  );
}
