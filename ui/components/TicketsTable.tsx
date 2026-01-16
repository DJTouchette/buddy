import React, { useState, useMemo } from "react";
import { ChevronUp, ChevronDown, ChevronRight } from "lucide-react";
import type { TicketWithPR } from "../../services/linkingService";

export type TicketSortField = "key" | "summary" | "status" | "assignee" | "type" | "priority" | "updated";
type SortDirection = "asc" | "desc";

interface TicketsTableProps {
  tickets: TicketWithPR[];
  sortField: TicketSortField | null;
  sortDirection: SortDirection;
  onSort: (field: TicketSortField) => void;
  onRowClick: (ticket: TicketWithPR) => void;
  navigate: (path: string) => void;
  onNavigateToTicket?: (ticketKey: string) => void;
  highlightedTicket?: string | null;
}

function SortIcon({ field, currentField, direction }: { field: TicketSortField; currentField: TicketSortField | null; direction: SortDirection }) {
  if (currentField === null || field !== currentField) return null;
  return direction === "asc" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />;
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

interface TicketRowProps {
  ticket: TicketWithPR;
  onRowClick: (ticket: TicketWithPR) => void;
  navigate: (path: string) => void;
  onNavigateToTicket?: (ticketKey: string) => void;
  isSubtask?: boolean;
  hasSubtasks?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  isHighlighted?: boolean;
}

function TicketRow({ ticket, onRowClick, navigate, onNavigateToTicket, isSubtask, hasSubtasks, isExpanded, onToggleExpand, isHighlighted }: TicketRowProps) {
  const handleTicketLinkClick = (e: React.MouseEvent, ticketKey: string) => {
    e.stopPropagation();
    if (onNavigateToTicket) {
      onNavigateToTicket(ticketKey);
    } else {
      navigate(`/tickets/${ticketKey}`);
    }
  };

  const handlePRLinkClick = (e: React.MouseEvent, prId: number, ticketKey: string) => {
    e.stopPropagation();
    // Set highlight so when user comes back, this ticket row is highlighted
    sessionStorage.setItem("highlightTicket", ticketKey);
    navigate(`/prs/${prId}`);
  };

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExpand?.();
  };

  return (
    <tr
      key={ticket.key}
      data-ticket-key={ticket.key}
      onClick={() => onRowClick(ticket)}
      className={`clickable-row ${isSubtask ? "subtask-row" : ""} ${isHighlighted ? "highlighted-row" : ""}`}
    >
      <td>
        <div className={`flex items-center gap-1 ${isSubtask ? "pl-6" : ""}`}>
          {hasSubtasks ? (
            <button
              onClick={handleExpandClick}
              className="expand-toggle"
              aria-label={isExpanded ? "Collapse subtasks" : "Expand subtasks"}
            >
              <ChevronRight className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
            </button>
          ) : !isSubtask ? (
            <span className="expand-toggle-spacer" />
          ) : null}
          {isSubtask && <span className="subtask-indent" />}
          <button
            className="jira-ticket-link"
            onClick={(e) => handleTicketLinkClick(e, ticket.key)}
          >
            {ticket.key}
          </button>
        </div>
      </td>
      <td className="text-sm">{ticket.fields.summary}</td>
      <td>
        <StatusBadge status={ticket.fields.status.name} />
      </td>
      <td className="text-sm text-muted">
        {ticket.fields.assignee?.displayName || "Unassigned"}
      </td>
      <td className="text-sm">{ticket.fields.issuetype.name}</td>
      <td>
        {ticket.linkedPR ? (
          <button
            className="jira-ticket-link text-sm"
            onClick={(e) => handlePRLinkClick(e, ticket.linkedPR!.pullRequestId, ticket.key)}
          >
            PR #{ticket.linkedPR.pullRequestId}
          </button>
        ) : (
          <span className="text-sm text-muted">-</span>
        )}
      </td>
    </tr>
  );
}

export function TicketsTable({ tickets, sortField, sortDirection, onSort, onRowClick, navigate, onNavigateToTicket, highlightedTicket }: TicketsTableProps) {
  // Track manually collapsed tickets instead - subtasks open by default
  const [collapsedTickets, setCollapsedTickets] = useState<Set<string>>(new Set());

  const columns: { key: TicketSortField; label: string; width?: string }[] = [
    { key: "key", label: "Key", width: "w-32" },
    { key: "summary", label: "Summary" },
    { key: "status", label: "Status", width: "w-32" },
    { key: "assignee", label: "Assignee", width: "w-40" },
    { key: "type", label: "Type", width: "w-24" },
  ];

  // Organize tickets hierarchically
  const { topLevelTickets, subtasksByParent } = useMemo(() => {
    const ticketKeySet = new Set<string>();
    const subtasksByParent = new Map<string, TicketWithPR[]>();

    // Build set of ticket keys in our list
    for (const ticket of tickets) {
      ticketKeySet.add(ticket.key);
    }

    // Group subtasks by parent (only if parent is in our list)
    for (const ticket of tickets) {
      if (ticket.fields.parent && ticketKeySet.has(ticket.fields.parent.key)) {
        const parentKey = ticket.fields.parent.key;
        const existing = subtasksByParent.get(parentKey) || [];
        existing.push(ticket);
        subtasksByParent.set(parentKey, existing);
      }
    }

    // Top-level tickets are:
    // 1. Tickets without a parent field, OR
    // 2. Subtasks whose parent is NOT in our list (orphan subtasks)
    const topLevelTickets = tickets.filter((t) =>
      !t.fields.parent || !ticketKeySet.has(t.fields.parent.key)
    );

    return { topLevelTickets, subtasksByParent };
  }, [tickets]);

  const toggleExpand = (ticketKey: string) => {
    setCollapsedTickets((prev) => {
      const next = new Set(prev);
      if (next.has(ticketKey)) {
        next.delete(ticketKey);
      } else {
        next.add(ticketKey);
      }
      return next;
    });
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
            <th className="w-40">Linked PR</th>
          </tr>
        </thead>
        <tbody>
          {topLevelTickets.map((ticket) => {
            const subtasks = subtasksByParent.get(ticket.key) || [];
            const hasSubtasks = subtasks.length > 0;
            // Subtasks open by default - expanded if NOT in collapsed set
            const isExpanded = hasSubtasks && !collapsedTickets.has(ticket.key);

            return (
              <React.Fragment key={ticket.key}>
                <TicketRow
                  ticket={ticket}
                  onRowClick={onRowClick}
                  navigate={navigate}
                  onNavigateToTicket={onNavigateToTicket}
                  hasSubtasks={hasSubtasks}
                  isExpanded={isExpanded}
                  onToggleExpand={() => toggleExpand(ticket.key)}
                  isHighlighted={highlightedTicket === ticket.key}
                />
                {isExpanded && subtasks.map((subtask) => (
                  <TicketRow
                    key={subtask.key}
                    ticket={subtask}
                    onRowClick={onRowClick}
                    navigate={navigate}
                    onNavigateToTicket={onNavigateToTicket}
                    isSubtask
                    isHighlighted={highlightedTicket === subtask.key}
                  />
                ))}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      {topLevelTickets.length === 0 && (
        <div className="text-center py-8 text-muted">No tickets found</div>
      )}
    </div>
  );
}
