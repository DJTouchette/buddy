import React, { useState, useMemo, useCallback, useEffect } from "react";
import { RefreshCw, Search, X, Plus } from "lucide-react";
import { useApi } from "../hooks/useApi";
import { PRsTable, type PRSortField } from "../components/PRsTable";
import { PRDetailModal } from "../components/PRDetailModal";
import type { PRWithTicket } from "../../services/linkingService";

interface PRsResponse {
  prs: PRWithTicket[];
  jiraHost: string;
}

interface PRsPageProps {
  navigate: (path: string) => void;
}

type SortDirection = "asc" | "desc";

// Parse URL search params into filter state
function getFiltersFromURL(): {
  search: string;
  status: string;
  author: string;
  target: string;
  sort: PRSortField;
  dir: SortDirection;
} {
  const params = new URLSearchParams(window.location.search);
  return {
    search: params.get("q") || "",
    status: params.get("status") || "all",
    author: params.get("author") || "all",
    target: params.get("target") || "all",
    sort: (params.get("sort") as PRSortField) || "id",
    dir: (params.get("dir") as SortDirection) || "desc",
  };
}

export function PRsPage({ navigate }: PRsPageProps) {
  const { data, setData, loading, error, refetch } = useApi<PRsResponse>("/api/prs");

  // Initialize state from URL
  const initialFilters = useMemo(() => getFiltersFromURL(), []);

  const [sortField, setSortField] = useState<PRSortField>(initialFilters.sort);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialFilters.dir);
  const [selectedPR, setSelectedPR] = useState<PRWithTicket | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [highlightedPR, setHighlightedPR] = useState<number | null>(null);

  // Check for PR to highlight (from returning from detail page)
  useEffect(() => {
    // Use a small delay to let navigation complete first
    const timer = setTimeout(() => {
      const prToHighlight = sessionStorage.getItem("highlightPR");
      if (prToHighlight && data?.prs) {
        setHighlightedPR(parseInt(prToHighlight));
        sessionStorage.removeItem("highlightPR");
        // Scroll to the PR row after a brief delay for render
        setTimeout(() => {
          const row = document.querySelector(`[data-pr-id="${prToHighlight}"]`);
          if (row) {
            row.scrollIntoView({ behavior: "smooth", block: "center" });
          }
          // Clear highlight after animation
          setTimeout(() => setHighlightedPR(null), 2000);
        }, 100);
      }
    }, 50);
    return () => clearTimeout(timer);
  });

  // Filter state - initialized from URL
  const [searchQuery, setSearchQuery] = useState(initialFilters.search);
  const [statusFilter, setStatusFilter] = useState<string>(initialFilters.status);
  const [authorFilter, setAuthorFilter] = useState<string>(initialFilters.author);
  const [targetFilter, setTargetFilter] = useState<string>(initialFilters.target);

  // Sync filter state to URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("q", searchQuery);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (authorFilter !== "all") params.set("author", authorFilter);
    if (targetFilter !== "all") params.set("target", targetFilter);
    if (sortField !== "id") params.set("sort", sortField);
    if (sortDirection !== "desc") params.set("dir", sortDirection);

    const newURL = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;

    window.history.replaceState({}, "", newURL);
  }, [searchQuery, statusFilter, authorFilter, targetFilter, sortField, sortDirection]);

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
    setAuthorFilter("all");
    setTargetFilter("all");
    setSortField("id");
    setSortDirection("desc");
  };

  const hasActiveFilters = searchQuery || statusFilter !== "all" || authorFilter !== "all" || targetFilter !== "all";

  // Extract unique values for filter dropdowns
  const filterOptions = useMemo(() => {
    if (!data?.prs) return { statuses: [], authors: [], targets: [] };

    const statuses = [...new Set(data.prs.map((pr) => pr.status))].sort();
    const authors = [...new Set(data.prs.map((pr) => pr.createdBy.displayName))].sort();
    const targets = [...new Set(data.prs.map((pr) => pr.targetRefName.replace("refs/heads/", "")))].sort();

    return { statuses, authors, targets };
  }, [data?.prs]);

  // Filter and sort PRs
  const filteredPRs = useMemo(() => {
    if (!data?.prs) return [];

    let prs = data.prs;

    // Apply text search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      prs = prs.filter((pr) => {
        const id = String(pr.pullRequestId);
        const title = pr.title.toLowerCase();
        const source = pr.sourceRefName.toLowerCase();
        const target = pr.targetRefName.toLowerCase();
        const author = pr.createdBy.displayName.toLowerCase();
        const status = pr.status.toLowerCase();

        return (
          id.includes(query) ||
          title.includes(query) ||
          source.includes(query) ||
          target.includes(query) ||
          author.includes(query) ||
          status.includes(query)
        );
      });
    }

    // Apply status filter
    if (statusFilter !== "all") {
      prs = prs.filter((pr) => pr.status === statusFilter);
    }

    // Apply author filter
    if (authorFilter !== "all") {
      prs = prs.filter((pr) => pr.createdBy.displayName === authorFilter);
    }

    // Apply target branch filter
    if (targetFilter !== "all") {
      prs = prs.filter((pr) => pr.targetRefName.replace("refs/heads/", "") === targetFilter);
    }

    // Apply sorting
    return [...prs].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortField) {
        case "id":
          aVal = a.pullRequestId;
          bVal = b.pullRequestId;
          break;
        case "title":
          aVal = a.title;
          bVal = b.title;
          break;
        case "source":
          aVal = a.sourceRefName;
          bVal = b.sourceRefName;
          break;
        case "target":
          aVal = a.targetRefName;
          bVal = b.targetRefName;
          break;
        case "status":
          aVal = a.status;
          bVal = b.status;
          break;
        case "author":
          aVal = a.createdBy.displayName;
          bVal = b.createdBy.displayName;
          break;
        default:
          return 0;
      }

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
      }

      const comparison = String(aVal).localeCompare(String(bVal));
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [data?.prs, searchQuery, statusFilter, authorFilter, targetFilter, sortField, sortDirection]);

  const handleSort = (field: PRSortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handleRowClick = useCallback((pr: PRWithTicket) => {
    setSelectedPR(pr);
  }, []);

  const handleTicketClick = useCallback((ticketKey: string, prId?: number) => {
    // Set highlight so when user comes back, this PR is highlighted
    if (prId) {
      sessionStorage.setItem("highlightPR", String(prId));
    } else if (selectedPR) {
      sessionStorage.setItem("highlightPR", String(selectedPR.pullRequestId));
    }
    // Navigate to ticket detail page from PR modal
    setSelectedPR(null);
    navigate(`/tickets/${ticketKey}`);
  }, [navigate, selectedPR]);

  const handleOpenFullPage = useCallback((prId: number) => {
    sessionStorage.setItem("highlightPR", String(prId));
    setSelectedPR(null);
    navigate(`/prs/${prId}`);
  }, [navigate]);

  const handleNavigateToPR = useCallback((prId: number) => {
    sessionStorage.setItem("highlightPR", String(prId));
    navigate(`/prs/${prId}`);
  }, [navigate]);

  // Handle PR update from description editing
  const handlePRUpdate = useCallback((updatedPR: PRWithTicket) => {
    // Update the selected PR
    setSelectedPR(updatedPR);
    // Update the PR in the list without refetching
    if (data) {
      setData({
        ...data,
        prs: data.prs.map((p) =>
          p.pullRequestId === updatedPR.pullRequestId ? updatedPR : p
        ),
      });
    }
  }, [data, setData]);

  if (loading) {
    return (
      <div className="text-center py-8 text-muted">
        Loading pull requests...
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
          Pull Requests
          {hasActiveFilters && (
            <span className="text-sm font-normal text-muted ml-2">
              ({filteredPRs.length} of {data?.prs.length})
            </span>
          )}
        </h1>
        <div className="flex items-center gap-2">
          <button onClick={() => navigate("/prs/create")} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" />
            Create PR
          </button>
          <button onClick={handleRefresh} disabled={refreshing} className="btn-secondary flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {/* Filters Row */}
      <div className="filters-row mb-4">
        <div className="search-input-wrapper">
          <Search className="w-4 h-4 search-icon" />
          <input
            type="text"
            placeholder="Filter by ID, title, branch, author..."
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
          value={authorFilter}
          onChange={(e) => setAuthorFilter(e.target.value)}
          className="filter-select"
        >
          <option value="all">All Authors</option>
          {filterOptions.authors.map((author) => (
            <option key={author} value={author}>{author}</option>
          ))}
        </select>

        <select
          value={targetFilter}
          onChange={(e) => setTargetFilter(e.target.value)}
          className="filter-select"
        >
          <option value="all">All Target Branches</option>
          {filterOptions.targets.map((target) => (
            <option key={target} value={target}>{target}</option>
          ))}
        </select>

        {hasActiveFilters && (
          <button onClick={clearFilters} className="btn-secondary flex items-center gap-1">
            <X className="w-4 h-4" />
            Clear
          </button>
        )}
      </div>

      <PRsTable
        prs={filteredPRs}
        sortField={sortField}
        sortDirection={sortDirection}
        onSort={handleSort}
        onRowClick={handleRowClick}
        navigate={navigate}
        onNavigateToPR={handleNavigateToPR}
        highlightedPR={highlightedPR}
      />

      <PRDetailModal
        pr={selectedPR}
        jiraHost={data?.jiraHost || ""}
        onClose={() => setSelectedPR(null)}
        onTicketClick={handleTicketClick}
        onOpenFullPage={handleOpenFullPage}
        onPRUpdate={handlePRUpdate}
      />
    </div>
  );
}
