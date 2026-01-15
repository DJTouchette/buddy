import React, { useState, useMemo, useCallback, useEffect } from "react";
import { RefreshCw, Search, X, Filter } from "lucide-react";
import { useApi } from "../hooks/useApi";
import { TicketsTable, type TicketSortField } from "../components/TicketsTable";
import { TicketDetailModal } from "../components/TicketDetailModal";
import type { TicketWithPR } from "../../services/linkingService";

interface TicketsResponse {
  tickets: TicketWithPR[];
  jiraHost: string;
}

interface TicketsPageProps {
  navigate: (path: string) => void;
}

type SortDirection = "asc" | "desc";

export function TicketsPage({ navigate }: TicketsPageProps) {
  const { data, loading, error, refetch } = useApi<TicketsResponse>("/api/tickets");
  // Default to no sorting to preserve board rank order
  const [sortField, setSortField] = useState<TicketSortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedTicket, setSelectedTicket] = useState<TicketWithPR | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [highlightedTicket, setHighlightedTicket] = useState<string | null>(null);

  // Check for ticket to highlight (from returning from detail page)
  // Use a small delay to let navigation complete first
  useEffect(() => {
    const timer = setTimeout(() => {
      const ticketToHighlight = sessionStorage.getItem("highlightTicket");
      if (ticketToHighlight && data?.tickets) {
        setHighlightedTicket(ticketToHighlight);
        sessionStorage.removeItem("highlightTicket");
        // Scroll to the ticket row after a brief delay for render
        setTimeout(() => {
          const row = document.querySelector(`[data-ticket-key="${ticketToHighlight}"]`);
          if (row) {
            row.scrollIntoView({ behavior: "smooth", block: "center" });
          }
          // Clear highlight after animation
          setTimeout(() => setHighlightedTicket(null), 2000);
        }, 100);
      }
    }, 50);
    return () => clearTimeout(timer);
  });

  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch("/api/refresh", { method: "POST" });
      await refetch();
    } finally {
      setRefreshing(false);
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setAssigneeFilter("all");
    setTypeFilter("all");
  };

  const hasActiveFilters = searchQuery || statusFilter !== "all" || assigneeFilter !== "all" || typeFilter !== "all";

  // Extract unique values for filter dropdowns
  const filterOptions = useMemo(() => {
    if (!data?.tickets) return { statuses: [], assignees: [], types: [] };

    const statuses = [...new Set(data.tickets.map((t) => t.fields.status.name))].sort();
    const assignees = [...new Set(data.tickets.map((t) => t.fields.assignee?.displayName).filter(Boolean))] as string[];
    assignees.sort();
    const types = [...new Set(data.tickets.map((t) => t.fields.issuetype.name))].sort();

    return { statuses, assignees, types };
  }, [data?.tickets]);

  // Filter and sort tickets
  const filteredTickets = useMemo(() => {
    if (!data?.tickets) return [];

    let tickets = data.tickets;

    // Apply text search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      tickets = tickets.filter((t) => {
        const key = t.key.toLowerCase();
        const summary = t.fields.summary.toLowerCase();
        const description = typeof t.fields.description === "string"
          ? t.fields.description.toLowerCase()
          : JSON.stringify(t.fields.description || "").toLowerCase();
        const assignee = t.fields.assignee?.displayName?.toLowerCase() || "";
        const status = t.fields.status.name.toLowerCase();

        return (
          key.includes(query) ||
          summary.includes(query) ||
          description.includes(query) ||
          assignee.includes(query) ||
          status.includes(query)
        );
      });
    }

    // Apply status filter
    if (statusFilter !== "all") {
      tickets = tickets.filter((t) => t.fields.status.name === statusFilter);
    }

    // Apply assignee filter
    if (assigneeFilter !== "all") {
      if (assigneeFilter === "unassigned") {
        tickets = tickets.filter((t) => !t.fields.assignee);
      } else {
        tickets = tickets.filter((t) => t.fields.assignee?.displayName === assigneeFilter);
      }
    }

    // Apply type filter
    if (typeFilter !== "all") {
      tickets = tickets.filter((t) => t.fields.issuetype.name === typeFilter);
    }

    // Apply sorting if set
    if (sortField) {
      tickets = [...tickets].sort((a, b) => {
        let aVal: string;
        let bVal: string;

        switch (sortField) {
          case "key":
            aVal = a.key;
            bVal = b.key;
            break;
          case "summary":
            aVal = a.fields.summary;
            bVal = b.fields.summary;
            break;
          case "status":
            aVal = a.fields.status.name;
            bVal = b.fields.status.name;
            break;
          case "assignee":
            aVal = a.fields.assignee?.displayName || "";
            bVal = b.fields.assignee?.displayName || "";
            break;
          case "type":
            aVal = a.fields.issuetype.name;
            bVal = b.fields.issuetype.name;
            break;
          case "priority":
            aVal = a.fields.priority?.name || "";
            bVal = b.fields.priority?.name || "";
            break;
          case "updated":
            aVal = a.fields.updated || "";
            bVal = b.fields.updated || "";
            break;
          default:
            return 0;
        }

        const comparison = aVal.localeCompare(bVal);
        return sortDirection === "asc" ? comparison : -comparison;
      });
    }

    return tickets;
  }, [data?.tickets, searchQuery, statusFilter, assigneeFilter, typeFilter, sortField, sortDirection]);

  const handleSort = (field: TicketSortField) => {
    if (sortField === field) {
      // If clicking the same field, toggle direction, or clear if it was desc
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else {
        // Clear sort to return to board rank order
        setSortField(null);
        setSortDirection("asc");
      }
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleRowClick = useCallback((ticket: TicketWithPR) => {
    setSelectedTicket(ticket);
  }, []);

  const handleTicketNavigate = useCallback(async (ticketKey: string) => {
    // Navigate to another ticket from within the modal
    const existingTicket = data?.tickets.find((t) => t.key === ticketKey);
    if (existingTicket) {
      setSelectedTicket(existingTicket);
      return;
    }
    // Fetch the ticket from API
    try {
      const response = await fetch(`/api/tickets/${ticketKey}`);
      if (response.ok) {
        const result = await response.json();
        if (result.ticket) {
          setSelectedTicket(result.ticket);
        }
      }
    } catch (err) {
      console.error("Failed to fetch ticket:", err);
    }
  }, [data?.tickets]);

  const handleOpenFullPage = useCallback((ticketKey: string) => {
    sessionStorage.setItem("highlightTicket", ticketKey);
    setSelectedTicket(null);
    navigate(`/tickets/${ticketKey}`);
  }, [navigate]);

  const handleNavigateToTicket = useCallback((ticketKey: string) => {
    sessionStorage.setItem("highlightTicket", ticketKey);
    navigate(`/tickets/${ticketKey}`);
  }, [navigate]);

  const handlePRClick = useCallback((prId: number) => {
    // Set highlight so when user comes back, this ticket is highlighted
    if (selectedTicket) {
      sessionStorage.setItem("highlightTicket", selectedTicket.key);
    }
    setSelectedTicket(null);
    navigate(`/prs/${prId}`);
  }, [navigate, selectedTicket]);

  if (loading) {
    return (
      <div className="text-center py-8 text-muted">
        Loading tickets...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500">
        Error: {error}
        <button onClick={refetch} className="ml-4 hover-underline">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold">
          Sprint Tickets
          {hasActiveFilters && (
            <span className="text-sm font-normal text-muted ml-2">
              ({filteredTickets.length} of {data?.tickets.length})
            </span>
          )}
        </h1>
        <button onClick={handleRefresh} disabled={refreshing} className="btn-primary flex items-center gap-2">
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Filters Row */}
      <div className="filters-row mb-4">
        <div className="search-input-wrapper">
          <Search className="w-4 h-4 search-icon" />
          <input
            type="text"
            placeholder="Filter by key, title, description, assignee..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          {searchQuery && (
            <button type="button" onClick={() => setSearchQuery("")} className="search-clear">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="filter-select"
        >
          <option value="all">All Statuses</option>
          {filterOptions.statuses.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>

        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="filter-select"
        >
          <option value="all">All Assignees</option>
          <option value="unassigned">Unassigned</option>
          {filterOptions.assignees.map((assignee) => (
            <option key={assignee} value={assignee}>{assignee}</option>
          ))}
        </select>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="filter-select"
        >
          <option value="all">All Types</option>
          {filterOptions.types.map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>

        {hasActiveFilters && (
          <button onClick={clearFilters} className="btn-secondary flex items-center gap-1">
            <X className="w-4 h-4" />
            Clear
          </button>
        )}
      </div>

      <TicketsTable
        tickets={filteredTickets}
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={handleSort}
        onRowClick={handleRowClick}
        navigate={navigate}
        onNavigateToTicket={handleNavigateToTicket}
        highlightedTicket={highlightedTicket}
      />

      <TicketDetailModal
        ticket={selectedTicket}
        jiraHost={data?.jiraHost || ""}
        onClose={() => setSelectedTicket(null)}
        onTicketClick={handleTicketNavigate}
        onPRClick={handlePRClick}
        onOpenFullPage={handleOpenFullPage}
      />
    </div>
  );
}
