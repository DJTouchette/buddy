import React, { useEffect, useState, useRef } from "react";
import {
  Loader2,
  RefreshCw,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  Trash2,
  Bot,
  Rocket,
  GitCompare,
  Hammer,
  Terminal,
  FileSearch,
  StopCircle,
} from "lucide-react";
import { JobOutput } from "../components/JobOutput";

interface Job {
  id: string;
  type: string;
  target: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "awaiting_approval";
  progress: number;
  output: string[];
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

interface JobsPageProps {
  navigate: (path: string) => void;
}

const JOB_TYPE_ICONS: Record<string, React.ElementType> = {
  "ai-fix": Bot,
  build: Hammer,
  deploy: Rocket,
  diff: GitCompare,
  synth: Terminal,
  "deploy-lambda": Rocket,
  "tail-logs": FileSearch,
};

const JOB_TYPE_LABELS: Record<string, string> = {
  "ai-fix": "AI Fix",
  build: "Build",
  deploy: "Deploy",
  diff: "Diff",
  synth: "Synth",
  "deploy-lambda": "Lambda Deploy",
  "tail-logs": "Tail Logs",
};

export function JobsPage({ navigate }: JobsPageProps) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const selectedJobRef = useRef<string | null>(null);

  const fetchJobs = async () => {
    try {
      const res = await fetch("/api/jobs");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs || []);

        // Update selected job if still viewing one
        if (selectedJobRef.current) {
          const updated = data.jobs?.find((j: Job) => j.id === selectedJobRef.current);
          if (updated) {
            setSelectedJob(updated);
          }
        }
      }
    } catch (err) {
      console.error("Failed to fetch jobs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
    const interval = setInterval(fetchJobs, 2000);
    return () => clearInterval(interval);
  }, []);

  const cancelJob = async (jobId: string) => {
    try {
      await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      fetchJobs();
    } catch (err) {
      console.error("Failed to cancel job:", err);
    }
  };

  const clearJobs = async () => {
    try {
      await fetch("/api/jobs/clear", { method: "POST" });
      setSelectedJob(null);
      selectedJobRef.current = null;
      fetchJobs();
    } catch (err) {
      console.error("Failed to clear jobs:", err);
    }
  };

  const handleSelectJob = (job: Job) => {
    setSelectedJob(job);
    selectedJobRef.current = job.id;
  };

  const handleCloseJob = () => {
    setSelectedJob(null);
    selectedJobRef.current = null;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "running":
      case "pending":
        return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
      case "completed":
        return <CheckCircle className="w-4 h-4 status-success" />;
      case "failed":
        return <XCircle className="w-4 h-4 status-error" />;
      case "cancelled":
        return <StopCircle className="w-4 h-4 text-muted" />;
      case "awaiting_approval":
        return <Clock className="w-4 h-4 text-yellow-500" />;
      default:
        return null;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "running":
        return <span className="badge badge-blue">Running</span>;
      case "pending":
        return <span className="badge badge-gray">Pending</span>;
      case "completed":
        return <span className="badge badge-green">Completed</span>;
      case "failed":
        return <span className="badge badge-red">Failed</span>;
      case "cancelled":
        return <span className="badge badge-gray">Cancelled</span>;
      case "awaiting_approval":
        return <span className="badge badge-yellow">Awaiting Approval</span>;
      default:
        return null;
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDuration = (startedAt: number, completedAt: number | null) => {
    const end = completedAt || Date.now();
    const seconds = Math.floor((end - startedAt) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  };

  const activeJobs = jobs.filter(
    (j) => j.status === "running" || j.status === "pending" || j.status === "awaiting_approval"
  );
  const completedJobs = jobs.filter(
    (j) => j.status === "completed" || j.status === "failed" || j.status === "cancelled"
  );

  if (loading) {
    return (
      <div className="text-center py-8 text-muted">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
        Loading jobs...
      </div>
    );
  }

  return (
    <div className="jobs-page">
      <div className="page-header">
        <h1>
          <Terminal className="w-6 h-6" />
          Jobs
        </h1>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={fetchJobs}>
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          {jobs.length > 0 && (
            <button className="btn-danger" onClick={clearJobs}>
              <Trash2 className="w-4 h-4" />
              Clear All
            </button>
          )}
        </div>
      </div>

      {jobs.length === 0 ? (
        <div className="empty-state">
          <Terminal className="w-12 h-12 text-muted" />
          <h3>No jobs</h3>
          <p className="text-muted">Jobs will appear here when you run builds, deploys, or AI fixes.</p>
        </div>
      ) : (
        <>
          {/* Active Jobs */}
          {activeJobs.length > 0 && (
            <section className="jobs-section">
              <h2 className="section-title">
                <Play className="w-5 h-5" />
                Active Jobs
                <span className="badge badge-blue">{activeJobs.length}</span>
              </h2>
              <div className="jobs-list">
                {activeJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onClick={() => handleSelectJob(job)}
                    onCancel={() => cancelJob(job.id)}
                    getStatusIcon={getStatusIcon}
                    getStatusBadge={getStatusBadge}
                    formatTime={formatTime}
                    formatDuration={formatDuration}
                    isSelected={selectedJob?.id === job.id}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Completed Jobs */}
          {completedJobs.length > 0 && (
            <section className="jobs-section">
              <h2 className="section-title">
                <FileSearch className="w-5 h-5" />
                Recent Jobs
                <span className="badge badge-gray">{completedJobs.length}</span>
              </h2>
              <div className="jobs-list">
                {completedJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    onClick={() => handleSelectJob(job)}
                    getStatusIcon={getStatusIcon}
                    getStatusBadge={getStatusBadge}
                    formatTime={formatTime}
                    formatDuration={formatDuration}
                    isSelected={selectedJob?.id === job.id}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* Job Output Panel */}
      {selectedJob && (
        <JobOutput
          job={selectedJob}
          onClose={handleCloseJob}
          onCancel={() => cancelJob(selectedJob.id)}
          onComplete={fetchJobs}
        />
      )}
    </div>
  );
}

interface JobCardProps {
  job: Job;
  onClick: () => void;
  onCancel?: () => void;
  getStatusIcon: (status: string) => React.ReactNode;
  getStatusBadge: (status: string) => React.ReactNode;
  formatTime: (timestamp: number) => string;
  formatDuration: (startedAt: number, completedAt: number | null) => string;
  isSelected: boolean;
}

function JobCard({
  job,
  onClick,
  onCancel,
  getStatusIcon,
  getStatusBadge,
  formatTime,
  formatDuration,
  isSelected,
}: JobCardProps) {
  const Icon = JOB_TYPE_ICONS[job.type] || Terminal;
  const typeLabel = JOB_TYPE_LABELS[job.type] || job.type;
  const isRunning = job.status === "running" || job.status === "pending";

  return (
    <div
      className={`job-card ${isSelected ? "selected" : ""} ${isRunning ? "running" : ""}`}
      onClick={onClick}
    >
      <div className="job-card-icon">
        <Icon className="w-5 h-5" />
      </div>
      <div className="job-card-content">
        <div className="job-card-header">
          <span className="job-card-type">{typeLabel}</span>
          <span className="job-card-target">{job.target}</span>
          {getStatusBadge(job.status)}
        </div>
        <div className="job-card-meta">
          <span className="job-card-time">{formatTime(job.startedAt)}</span>
          <span className="job-card-duration">
            {formatDuration(job.startedAt, job.completedAt)}
          </span>
          {job.error && <span className="job-card-error">{job.error}</span>}
        </div>
        {isRunning && job.progress > 0 && (
          <div className="job-card-progress">
            <div className="job-card-progress-bar" style={{ width: `${job.progress}%` }} />
          </div>
        )}
      </div>
      <div className="job-card-actions">
        {getStatusIcon(job.status)}
        {isRunning && onCancel && (
          <button
            className="btn-icon-sm btn-danger"
            onClick={(e) => {
              e.stopPropagation();
              onCancel();
            }}
            title="Cancel"
          >
            <StopCircle className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
