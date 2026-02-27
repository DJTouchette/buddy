import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  AlertCircle,
  Clock,
  MessageSquare,
  GitPullRequest,
  GitMerge,
  Hammer,
  Play,
  ArrowRightCircle,
  MessageCircle,
} from "lucide-react";

type ActivityEventType =
  | "pr_comment"
  | "pr_created"
  | "pr_completed"
  | "build_completed"
  | "job_completed"
  | "ticket_transition"
  | "ticket_comment";

interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  timestamp: string;
  title: string;
  description?: string;
  author?: string;
  source: "jira" | "azure" | "jobs";
  link?: { type: "ticket" | "pr" | "job"; path?: string; url?: string };
  metadata?: Record<string, any>;
}

interface ActivityData {
  events: ActivityEvent[];
  cachedAt: number;
}

interface ActivityPageProps {
  navigate: (path: string) => void;
}

const EVENT_TYPE_CONFIG: Record<
  ActivityEventType,
  { icon: React.ElementType; color: string; label: string }
> = {
  pr_comment: { icon: MessageSquare, color: "blue", label: "PR Comments" },
  pr_created: { icon: GitPullRequest, color: "green", label: "PRs Created" },
  pr_completed: { icon: GitMerge, color: "purple", label: "PRs Completed" },
  build_completed: { icon: Hammer, color: "amber", label: "Builds" },
  job_completed: { icon: Play, color: "gray", label: "Jobs" },
  ticket_transition: { icon: ArrowRightCircle, color: "teal", label: "Ticket Updates" },
  ticket_comment: { icon: MessageCircle, color: "indigo", label: "Ticket Comments" },
};

type FilterType = "all" | ActivityEventType;

const FILTER_OPTIONS: { key: FilterType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pr_comment", label: "PR Comments" },
  { key: "pr_created", label: "PRs" },
  { key: "build_completed", label: "Builds" },
  { key: "job_completed", label: "Jobs" },
  { key: "ticket_transition", label: "Ticket Updates" },
  { key: "ticket_comment", label: "Ticket Comments" },
];

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function groupByDay(events: ActivityEvent[]): Map<string, ActivityEvent[]> {
  const groups = new Map<string, ActivityEvent[]>();
  for (const event of events) {
    const day = new Date(event.timestamp).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day)!.push(event);
  }
  return groups;
}

function EventCard({
  event,
  onClick,
}: {
  event: ActivityEvent;
  onClick: () => void;
}) {
  const config = EVENT_TYPE_CONFIG[event.type];
  const Icon = config.icon;

  const sourceBadgeClass =
    event.source === "jira"
      ? "activity-source-jira"
      : event.source === "azure"
        ? "activity-source-azure"
        : "activity-source-jobs";

  return (
    <div className="activity-event-card" onClick={onClick}>
      <div className={`activity-event-icon activity-icon-${config.color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="activity-event-content">
        <div className="activity-event-title">{event.title}</div>
        {event.description && (
          <div className="activity-event-description">{event.description}</div>
        )}
        <div className="activity-event-meta">
          {event.author && <span className="activity-event-author">{event.author}</span>}
          <span className="activity-event-time">{timeAgo(event.timestamp)}</span>
          <span className={`activity-source-badge ${sourceBadgeClass}`}>{event.source}</span>
        </div>
      </div>
    </div>
  );
}

export function ActivityPage({ navigate }: ActivityPageProps) {
  const [data, setData] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");

  const fetchActivity = async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const url = forceRefresh ? "/api/activity?refresh=true" : "/api/activity";
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to load activity");
      }
      const activityData = await response.json();
      setData(activityData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load activity");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchActivity();
  }, []);

  const handleBack = () => {
    navigate("/dashboard");
  };

  const handleEventClick = (event: ActivityEvent) => {
    if (event.link?.path) {
      navigate(event.link.path);
    } else if (event.link?.url) {
      window.open(event.link.url, "_blank");
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-muted">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
        Loading activity feed...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <div className="text-red-500 mb-4">{error}</div>
        <button onClick={() => fetchActivity()} className="btn-secondary">
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  // Client-side filtering
  const filteredEvents =
    activeFilter === "all"
      ? data.events
      : data.events.filter((e) => e.type === activeFilter);

  const dayGroups = groupByDay(filteredEvents);

  const cachedAgo = data.cachedAt
    ? Math.floor((Date.now() - data.cachedAt) / 60000)
    : null;

  return (
    <div className="activity-page">
      <div className="activity-header">
        <div className="activity-header-left">
          <button onClick={handleBack} className="btn-secondary">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <h1>Activity</h1>
        </div>
        <div className="activity-header-right">
          {cachedAgo !== null && (
            <span className="activity-cache-info">
              <Clock className="w-4 h-4" />
              Cached {cachedAgo} min ago
            </span>
          )}
          <button
            className="btn-secondary"
            onClick={() => fetchActivity(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="activity-filters">
        {FILTER_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            className={`activity-filter-pill ${activeFilter === opt.key ? "active" : ""}`}
            onClick={() => setActiveFilter(opt.key)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="activity-timeline">
        {dayGroups.size === 0 ? (
          <div className="activity-empty">
            <Clock className="w-8 h-8" />
            <p>No activity found</p>
          </div>
        ) : (
          Array.from(dayGroups.entries()).map(([day, events]) => (
            <div key={day} className="activity-day-group">
              <div className="activity-day-label">{day}</div>
              <div className="activity-day-events">
                {events.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    onClick={() => handleEventClick(event)}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
