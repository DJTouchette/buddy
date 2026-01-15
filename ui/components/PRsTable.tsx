import React from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { PRWithTicket } from "../../services/linkingService";

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

export function PRsTable({ prs, sortField, sortDirection, onSort, onRowClick, navigate, onNavigateToPR, highlightedPR }: PRsTableProps) {
  const columns: { key: PRSortField; label: string; width?: string }[] = [
    { key: "id", label: "ID", width: "w-20" },
    { key: "title", label: "Title" },
    { key: "source", label: "Source", width: "w-48" },
    { key: "target", label: "Target", width: "w-32" },
    { key: "status", label: "Status", width: "w-24" },
    { key: "author", label: "Author", width: "w-36" },
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
              <td>
                <PRStatusBadge status={pr.status} />
              </td>
              <td className="text-sm text-muted">
                {pr.createdBy.displayName}
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
