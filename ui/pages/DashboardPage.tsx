import React, { useEffect, useState } from "react";
import {
  Loader2,
  RefreshCw,
  Ticket,
  GitPullRequest,
  Eye,
  ExternalLink,
  AlertCircle,
  CheckCircle,
  Clock,
  User,
  ThumbsUp,
  ThumbsDown,
  MinusCircle,
  XCircle,
  Hourglass,
  MessageSquare,
  Users,
  AlertTriangle,
  BarChart3,
} from "lucide-react";
import type { JiraIssue } from "../../services/jiraService";

interface PRReviewer {
  id: string;
  displayName: string;
  vote: number; // 10 = approved, 5 = approved with suggestions, 0 = no vote, -5 = waiting for author, -10 = rejected
  isRequired?: boolean;
  isContainer?: boolean; // true for group reviewers like "QA Team"
}

interface DashboardPR {
  pullRequestId: number;
  title: string;
  description?: string;
  sourceRefName: string;
  targetRefName: string;
  status: string;
  createdBy: {
    displayName: string;
  };
  url: string;
  webUrl: string;
  reviewers?: PRReviewer[];
}

interface RecentActivity {
  prId: number;
  prTitle: string;
  comment: string;
  author: string;
  date: string;
  webUrl: string;
}

interface DashboardData {
  myIssues: JiraIssue[];
  myPRs: DashboardPR[];
  prsToReview: DashboardPR[];
  failedBuilds: DashboardPR[];
  stalePRs: DashboardPR[];
  blockedPRs: DashboardPR[];
  teamPRs: DashboardPR[];
  recentActivity: RecentActivity[];
  jiraHost: string;
  timestamp?: number;
  fromCache?: boolean;
}

interface DashboardPageProps {
  navigate: (path: string) => void;
}

function IssueCard({ issue, jiraHost, onClick }: { issue: JiraIssue; jiraHost: string; onClick: () => void }) {
  const statusColors: Record<string, string> = {
    "Done": "badge-green",
    "In Progress": "badge-blue",
    "In Review": "badge-purple",
    "To Do": "badge-gray",
  };

  return (
    <div className="dashboard-card clickable-card" onClick={onClick}>
      <div className="dashboard-card-header">
        <span className="dashboard-card-key">{issue.key}</span>
        <span className={`badge ${statusColors[issue.fields.status.name] || "badge-gray"}`}>
          {issue.fields.status.name}
        </span>
      </div>
      <div className="dashboard-card-title">{issue.fields.summary}</div>
      <div className="dashboard-card-meta">
        <span className="text-muted text-xs">{issue.fields.issuetype.name}</span>
        {issue.fields.priority && (
          <span className="text-muted text-xs">{issue.fields.priority.name}</span>
        )}
      </div>
    </div>
  );
}

function getApprovalStatus(reviewers?: PRReviewer[]): { status: "approved" | "rejected" | "pending" | "waiting"; approvedCount: number; totalCount: number } {
  if (!reviewers || reviewers.length === 0) {
    return { status: "pending", approvedCount: 0, totalCount: 0 };
  }

  // Filter out group/container reviewers for counting individual approvals
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
    return null;
  }

  const statusConfig = {
    approved: { icon: ThumbsUp, className: "approval-approved", label: "Approved" },
    rejected: { icon: ThumbsDown, className: "approval-rejected", label: "Rejected" },
    waiting: { icon: Clock, className: "approval-waiting", label: "Changes requested" },
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

function PRCard({ pr, onClick, showAuthor }: { pr: DashboardPR; onClick: () => void; showAuthor?: boolean }) {
  const statusColors: Record<string, string> = {
    "active": "badge-blue",
    "completed": "badge-green",
    "abandoned": "badge-gray",
  };

  const sourceBranch = pr.sourceRefName.replace("refs/heads/", "");
  const targetBranch = pr.targetRefName.replace("refs/heads/", "");

  return (
    <div className="dashboard-card clickable-card" onClick={onClick}>
      <div className="dashboard-card-header">
        <span className="dashboard-card-key">#{pr.pullRequestId}</span>
        <div className="dashboard-card-badges">
          <ApprovalBadge reviewers={pr.reviewers} />
          <span className={`badge ${statusColors[pr.status] || "badge-gray"}`}>
            {pr.status}
          </span>
        </div>
      </div>
      <div className="dashboard-card-title">{pr.title}</div>
      <div className="dashboard-card-meta">
        <code className="text-xs">{sourceBranch} → {targetBranch}</code>
      </div>
      {showAuthor && (
        <div className="dashboard-card-author">
          <User className="w-3 h-3" />
          <span>{pr.createdBy.displayName}</span>
        </div>
      )}
    </div>
  );
}

function ActivityCard({ activity, onClick }: { activity: RecentActivity; onClick: () => void }) {
  const timeAgo = (date: string) => {
    const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div className="activity-card clickable-card" onClick={onClick}>
      <div className="activity-header">
        <span className="activity-author">{activity.author}</span>
        <span className="activity-time">{timeAgo(activity.date)}</span>
      </div>
      <div className="activity-pr">on #{activity.prId}: {activity.prTitle}</div>
      <div className="activity-comment">{activity.comment}</div>
    </div>
  );
}

function DashboardSection({
  title,
  icon: Icon,
  count,
  children,
  emptyMessage,
  variant
}: {
  title: string;
  icon: React.ElementType;
  count: number;
  children: React.ReactNode;
  emptyMessage: string;
  variant?: "default" | "warning" | "error";
}) {
  const headerClass = variant === "error" ? "dashboard-section-header-error" :
                      variant === "warning" ? "dashboard-section-header-warning" : "";

  return (
    <div className="dashboard-section">
      <div className={`dashboard-section-header ${headerClass}`}>
        <Icon className="w-5 h-5" />
        <h2>{title}</h2>
        <span className="badge badge-sm">{count}</span>
      </div>
      <div className="dashboard-section-content">
        {count > 0 ? children : (
          <div className="dashboard-empty">
            <span className="text-muted">{emptyMessage}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function DashboardPage({ navigate }: DashboardPageProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [isLive, setIsLive] = useState(true);

  const fetchDashboard = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else if (!data) {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await fetch("/api/dashboard" + (isRefresh ? "?refresh=true" : ""));
      if (!response.ok) {
        throw new Error("Failed to load dashboard");
      }
      const dashboardData = await response.json();
      setData(dashboardData);
      setLastUpdated(new Date(dashboardData.timestamp || Date.now()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Initial fetch - load cached data immediately
  useEffect(() => {
    fetchDashboard();
  }, []);

  // SSE connection for live updates (only after initial data is loaded)
  useEffect(() => {
    // Don't connect SSE until we have initial data loaded
    if (!isLive || loading) return;

    const eventSource = new EventSource("/api/dashboard/stream");

    eventSource.onmessage = (event) => {
      try {
        const newData = JSON.parse(event.data);
        if (newData.error) {
          console.error("Dashboard SSE error:", newData.error);
          return;
        }
        // Validate data has expected structure before setting
        if (newData.jiraHost !== undefined) {
          setData(newData);
          setLastUpdated(new Date(newData.timestamp || Date.now()));
        }
      } catch (err) {
        console.error("Failed to parse dashboard SSE data:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("Dashboard SSE connection error:", err);
      // Don't set error state - just log it, the connection will retry automatically
    };

    return () => {
      eventSource.close();
    };
  }, [isLive, loading]);

  const handleIssueClick = (issueKey: string) => {
    navigate(`/tickets/${issueKey}`);
  };

  const handlePRClick = (prId: number) => {
    navigate(`/prs/${prId}`);
  };

  const handleActivityClick = (activity: RecentActivity) => {
    window.open(activity.webUrl, "_blank");
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-muted">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
        Loading dashboard...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <div className="text-red-500 mb-4">{error}</div>
        <button onClick={() => fetchDashboard()} className="btn-secondary">
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  // Ensure all arrays exist with fallbacks
  const myIssues = data.myIssues || [];
  const myPRs = data.myPRs || [];
  const prsToReview = data.prsToReview || [];
  const failedBuilds = data.failedBuilds || [];
  const stalePRs = data.stalePRs || [];
  const blockedPRs = data.blockedPRs || [];
  const teamPRs = data.teamPRs || [];
  const recentActivity = data.recentActivity || [];

  const formatLastUpdated = (date: Date) => {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-header-title">
          <h1>Dashboard</h1>
          {lastUpdated && (
            <span className="dashboard-last-updated">
              Last updated: {formatLastUpdated(lastUpdated)}
              {isLive && <span className="live-indicator" title="Live updates enabled" />}
            </span>
          )}
        </div>
        <div className="dashboard-header-actions">
          <button
            className="btn-secondary"
            onClick={() => navigate("/stats")}
          >
            <BarChart3 className="w-4 h-4" />
            Stats
          </button>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={isLive}
              onChange={(e) => setIsLive(e.target.checked)}
            />
            <span>Live</span>
          </label>
          <button
            className="btn-secondary"
            onClick={() => fetchDashboard(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="dashboard-grid">
        {/* My Issues */}
        <DashboardSection
          title="My Issues"
          icon={Ticket}
          count={myIssues.length}
          emptyMessage="No issues assigned to you"
        >
          <div className="dashboard-cards">
            {myIssues.map((issue) => (
              <IssueCard
                key={issue.key}
                issue={issue}
                jiraHost={data.jiraHost}
                onClick={() => handleIssueClick(issue.key)}
              />
            ))}
          </div>
        </DashboardSection>

        {/* My PRs */}
        <DashboardSection
          title="My Pull Requests"
          icon={GitPullRequest}
          count={myPRs.length}
          emptyMessage="No open pull requests"
        >
          <div className="dashboard-cards">
            {myPRs.map((pr) => (
              <PRCard
                key={pr.pullRequestId}
                pr={pr}
                onClick={() => handlePRClick(pr.pullRequestId)}
              />
            ))}
          </div>
        </DashboardSection>

        {/* PRs to Review */}
        <DashboardSection
          title="PRs to Review"
          icon={Eye}
          count={prsToReview.length}
          emptyMessage="No pull requests to review"
        >
          <div className="dashboard-cards">
            {prsToReview.map((pr) => (
              <PRCard
                key={pr.pullRequestId}
                pr={pr}
                onClick={() => handlePRClick(pr.pullRequestId)}
                showAuthor
              />
            ))}
          </div>
        </DashboardSection>

        {/* Failed Builds */}
        <DashboardSection
          title="Failed Builds"
          icon={XCircle}
          count={failedBuilds.length}
          emptyMessage="No failed builds"
          variant="error"
        >
          <div className="dashboard-cards">
            {failedBuilds.map((pr) => (
              <PRCard
                key={pr.pullRequestId}
                pr={pr}
                onClick={() => handlePRClick(pr.pullRequestId)}
              />
            ))}
          </div>
        </DashboardSection>

        {/* Blocked/Waiting */}
        <DashboardSection
          title="Changes Requested"
          icon={AlertTriangle}
          count={blockedPRs.length}
          emptyMessage="No PRs waiting for changes"
          variant="warning"
        >
          <div className="dashboard-cards">
            {blockedPRs.map((pr) => (
              <PRCard
                key={pr.pullRequestId}
                pr={pr}
                onClick={() => handlePRClick(pr.pullRequestId)}
              />
            ))}
          </div>
        </DashboardSection>

        {/* Stale PRs */}
        <DashboardSection
          title="Stale PRs (7+ days)"
          icon={Hourglass}
          count={stalePRs.length}
          emptyMessage="No stale pull requests"
          variant="warning"
        >
          <div className="dashboard-cards">
            {stalePRs.map((pr) => (
              <PRCard
                key={pr.pullRequestId}
                pr={pr}
                onClick={() => handlePRClick(pr.pullRequestId)}
                showAuthor
              />
            ))}
          </div>
        </DashboardSection>

        {/* Recent Activity */}
        <DashboardSection
          title="Recent Activity"
          icon={MessageSquare}
          count={recentActivity.length}
          emptyMessage="No recent activity"
        >
          <div className="dashboard-cards">
            {recentActivity.map((activity, idx) => (
              <ActivityCard
                key={`${activity.prId}-${idx}`}
                activity={activity}
                onClick={() => handleActivityClick(activity)}
              />
            ))}
          </div>
        </DashboardSection>

        {/* Team Overview */}
        <DashboardSection
          title="Team Activity"
          icon={Users}
          count={teamPRs.length}
          emptyMessage="No team activity"
        >
          <div className="dashboard-cards">
            {teamPRs.slice(0, 10).map((pr) => (
              <PRCard
                key={pr.pullRequestId}
                pr={pr}
                onClick={() => handlePRClick(pr.pullRequestId)}
                showAuthor
              />
            ))}
          </div>
        </DashboardSection>
      </div>
    </div>
  );
}
