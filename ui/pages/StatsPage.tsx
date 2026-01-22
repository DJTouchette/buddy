import React, { useEffect, useState } from "react";
import {
  ArrowLeft,
  Loader2,
  RefreshCw,
  AlertCircle,
  Ticket,
  GitPullRequest,
  GitMerge,
  TrendingUp,
  Calendar,
  Clock,
} from "lucide-react";

interface MonthlyData {
  month: string;
  label: string;
  ticketsCompleted: number;
  prsCreated: number;
  prsMerged: number;
}

interface StatsData {
  summary: {
    totalTicketsCompleted: number;
    totalPRsCreated: number;
    totalPRsMerged: number;
    periodStart: string;
    periodEnd: string;
  };
  monthly: MonthlyData[];
  cachedAt: number;
}

interface StatsPageProps {
  navigate: (path: string) => void;
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className={`stat-card stat-card-${color}`}>
      <div className="stat-card-icon">
        <Icon className="w-6 h-6" />
      </div>
      <div className="stat-card-content">
        <div className="stat-card-value">{value}</div>
        <div className="stat-card-label">{label}</div>
      </div>
    </div>
  );
}

function BarChart({
  data,
  dataKey,
  color,
  label,
}: {
  data: MonthlyData[];
  dataKey: keyof MonthlyData;
  color: string;
  label: string;
}) {
  const values = data.map((d) => d[dataKey] as number);
  const maxValue = Math.max(...values, 1);

  return (
    <div className="chart-container">
      <div className="chart-header">
        <h3>{label}</h3>
        <span className="chart-max">Max: {maxValue}</span>
      </div>
      <div className="chart-bars">
        {data.map((d, i) => {
          const value = d[dataKey] as number;
          const height = (value / maxValue) * 100;
          return (
            <div key={d.month} className="chart-bar-wrapper">
              <div className="chart-bar-value">{value > 0 ? value : ""}</div>
              <div
                className={`chart-bar chart-bar-${color}`}
                style={{ height: `${Math.max(height, 2)}%` }}
                title={`${d.label}: ${value}`}
              />
              <div className="chart-bar-label">
                {i % 2 === 0 ? d.label.split(" ")[0] : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CombinedChart({ data }: { data: MonthlyData[] }) {
  const maxTickets = Math.max(...data.map((d) => d.ticketsCompleted), 1);
  const maxPRs = Math.max(...data.map((d) => d.prsCreated), 1);
  const maxMerged = Math.max(...data.map((d) => d.prsMerged), 1);
  const maxValue = Math.max(maxTickets, maxPRs, maxMerged);

  return (
    <div className="chart-container chart-combined">
      <div className="chart-header">
        <h3>Monthly Overview</h3>
        <div className="chart-legend">
          <span className="legend-item legend-green">
            <span className="legend-dot" /> Tickets
          </span>
          <span className="legend-item legend-blue">
            <span className="legend-dot" /> PRs Created
          </span>
          <span className="legend-item legend-purple">
            <span className="legend-dot" /> PRs Merged
          </span>
        </div>
      </div>
      <div className="chart-bars chart-bars-grouped">
        {data.map((d, i) => {
          const ticketHeight = (d.ticketsCompleted / maxValue) * 100;
          const prHeight = (d.prsCreated / maxValue) * 100;
          const mergedHeight = (d.prsMerged / maxValue) * 100;

          return (
            <div key={d.month} className="chart-bar-group">
              <div className="chart-bar-group-bars">
                <div
                  className="chart-bar chart-bar-green"
                  style={{ height: `${Math.max(ticketHeight, 2)}%` }}
                  title={`Tickets: ${d.ticketsCompleted}`}
                />
                <div
                  className="chart-bar chart-bar-blue"
                  style={{ height: `${Math.max(prHeight, 2)}%` }}
                  title={`PRs Created: ${d.prsCreated}`}
                />
                <div
                  className="chart-bar chart-bar-purple"
                  style={{ height: `${Math.max(mergedHeight, 2)}%` }}
                  title={`PRs Merged: ${d.prsMerged}`}
                />
              </div>
              <div className="chart-bar-label">
                {i % 2 === 0 ? d.label.split(" ")[0] : ""}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function StatsPage({ navigate }: StatsPageProps) {
  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async (forceRefresh = false) => {
    if (forceRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const url = forceRefresh ? "/api/stats?refresh=true" : "/api/stats";
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to load stats");
      }
      const statsData = await response.json();
      setData(statsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleBack = () => {
    navigate("/dashboard");
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-muted">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
        Loading stats... (this may take a moment on first load)
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <div className="text-red-500 mb-4">{error}</div>
        <button onClick={() => fetchStats()} className="btn-secondary">
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const cachedAgo = data.cachedAt
    ? Math.floor((Date.now() - data.cachedAt) / 60000)
    : null;

  return (
    <div className="stats-page">
      <div className="stats-header">
        <div className="stats-header-left">
          <button onClick={handleBack} className="btn-secondary">
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <h1>Your Stats</h1>
        </div>
        <div className="stats-header-right">
          {cachedAgo !== null && (
            <span className="stats-cache-info">
              <Clock className="w-4 h-4" />
              Cached {cachedAgo} min ago
            </span>
          )}
          <button
            className="btn-secondary"
            onClick={() => fetchStats(true)}
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      <div className="stats-period">
        <Calendar className="w-4 h-4" />
        <span>
          {new Date(data.summary.periodStart).toLocaleDateString("en-US", {
            month: "short",
            year: "numeric",
          })}{" "}
          -{" "}
          {new Date(data.summary.periodEnd).toLocaleDateString("en-US", {
            month: "short",
            year: "numeric",
          })}
        </span>
      </div>

      {/* Summary Cards */}
      <div className="stats-cards">
        <StatCard
          icon={Ticket}
          label="Tickets Completed"
          value={data.summary.totalTicketsCompleted}
          color="green"
        />
        <StatCard
          icon={GitPullRequest}
          label="PRs Created"
          value={data.summary.totalPRsCreated}
          color="blue"
        />
        <StatCard
          icon={GitMerge}
          label="PRs Merged"
          value={data.summary.totalPRsMerged}
          color="purple"
        />
      </div>

      {/* Combined Chart */}
      <CombinedChart data={data.monthly} />

      {/* Individual Charts */}
      <div className="stats-charts-grid">
        <BarChart
          data={data.monthly}
          dataKey="ticketsCompleted"
          color="green"
          label="Tickets Completed by Month"
        />
        <BarChart
          data={data.monthly}
          dataKey="prsCreated"
          color="blue"
          label="PRs Created by Month"
        />
      </div>
    </div>
  );
}
