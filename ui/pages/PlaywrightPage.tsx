import React, { useEffect, useState, useRef } from "react";
import {
  Loader2,
  RefreshCw,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  Search,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  StopCircle,
  CircleDot,
  MinusCircle,
  MonitorCheck,
} from "lucide-react";

interface Spec {
  file: string;
  name: string;
  project: string;
}

interface Job {
  id: string;
  type: string;
  target: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  output: string[];
  startedAt: number;
}

interface PwTestResult {
  index: number;
  project: string;
  file: string;
  title: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  duration: string;
  output: string[];
}

interface PwRunState {
  phase: "installing" | "running" | "done";
  tests: PwTestResult[];
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  startedAt: number;
  error: string | null;
}

type View = "specs" | "running";

export function PlaywrightPage() {
  const [specs, setSpecs] = useState<Spec[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [selectedSpecs, setSelectedSpecs] = useState<Set<string>>(new Set());
  const [project, setProject] = useState("all");
  const [view, setView] = useState<View>("specs");

  // Running state
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const activeJobRef = useRef<string | null>(null);
  const [runState, setRunState] = useState<PwRunState | null>(null);
  const [showRawOutput, setShowRawOutput] = useState(false);
  const [expandedFailure, setExpandedFailure] = useState<number | null>(null);

  useEffect(() => {
    fetchSpecs();
  }, []);

  // Poll active job + run state
  useEffect(() => {
    if (!activeJobRef.current) return;
    const interval = setInterval(() => {
      fetchActiveJob();
      fetchRunState();
    }, 800);
    return () => clearInterval(interval);
  }, [activeJob?.id]);

  const fetchSpecs = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/playwright/specs");
      const data = await res.json();
      setSpecs(data.specs || []);
    } catch (err) {
      console.error("Failed to fetch specs:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchActiveJob = async () => {
    if (!activeJobRef.current) return;
    try {
      const res = await fetch(`/api/jobs/${activeJobRef.current}`);
      if (res.ok) {
        const data = await res.json();
        if (data.job) setActiveJob(data.job);
      }
    } catch {}
  };

  const fetchRunState = async () => {
    if (!activeJobRef.current) return;
    try {
      const res = await fetch(`/api/playwright/run/${activeJobRef.current}/status`);
      if (res.ok) {
        const data = await res.json();
        if (data.state) setRunState(data.state);
      }
    } catch {}
  };

  const runTests = async (specFiles?: string[]) => {
    try {
      const body: any = { project };
      if (specFiles && specFiles.length > 0) {
        body.specs = specFiles;
      }
      const res = await fetch("/api/playwright/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.job) {
        setActiveJob(data.job);
        activeJobRef.current = data.job.id;
        setRunState(null);
        setShowRawOutput(false);
        setExpandedFailure(null);
        setView("running");
      }
    } catch (err) {
      console.error("Failed to run tests:", err);
    }
  };

  const cancelJob = async () => {
    if (!activeJobRef.current) return;
    try {
      await fetch(`/api/jobs/${activeJobRef.current}/cancel`, { method: "POST" });
      fetchActiveJob();
    } catch (err) {
      console.error("Failed to cancel job:", err);
    }
  };

  const goBack = () => {
    setActiveJob(null);
    activeJobRef.current = null;
    setRunState(null);
    setView("specs");
  };

  const toggleSpec = (file: string) => {
    setSelectedSpecs((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  const filteredSpecs = specs.filter((s) => {
    const matchesFilter = !filter || s.name.toLowerCase().includes(filter.toLowerCase()) || s.file.toLowerCase().includes(filter.toLowerCase());
    const matchesProject = project === "all" || s.project === project;
    return matchesFilter && matchesProject;
  });

  if (loading) {
    return (
      <div className="text-center py-8 text-muted">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
        Loading Playwright specs...
      </div>
    );
  }

  // ── Running View ─────────────────────────────────────────────────────

  if (view === "running" && activeJob) {
    const isRunning = activeJob.status === "running" || activeJob.status === "pending";
    const completed = runState ? runState.passed + runState.failed + runState.skipped : 0;
    const total = runState?.total || 0;
    const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

    return (
      <div className="ctest-page">
        <div className="ctest-run-header">
          <div className="ctest-run-header-left">
            <button className="btn-icon" onClick={goBack} title="Back">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <MonitorCheck className="w-5 h-5" />
            <span className="ctest-run-title">{activeJob.target}</span>
            {getStatusBadge(activeJob.status)}
          </div>
          <div className="ctest-run-header-right">
            {runState?.phase === "running" && (
              <span className="ctest-phase-badge ctest-phase-running">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Running...
              </span>
            )}
            {isRunning && (
              <button className="btn-secondary btn-sm" onClick={cancelJob}>
                <StopCircle className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Summary bar */}
        {runState && (
          <div className="ctest-summary">
            <div className="ctest-summary-counts">
              {runState.passed > 0 && (
                <span className="ctest-count ctest-count-passed">
                  <CheckCircle className="w-4 h-4" />
                  {runState.passed} passed
                </span>
              )}
              {runState.failed > 0 && (
                <span className="ctest-count ctest-count-failed">
                  <XCircle className="w-4 h-4" />
                  {runState.failed} failed
                </span>
              )}
              {runState.skipped > 0 && (
                <span className="ctest-count ctest-count-skipped">
                  <MinusCircle className="w-4 h-4" />
                  {runState.skipped} skipped
                </span>
              )}
              {total > 0 && (
                <span className="ctest-count ctest-count-total">
                  {completed}/{total}
                </span>
              )}
              {runState.startedAt > 0 && (
                <span className="ctest-count ctest-count-time">
                  <Clock className="w-3.5 h-3.5" />
                  <ElapsedTime startedAt={runState.startedAt} done={runState.phase === "done"} />
                </span>
              )}
            </div>
            {total > 0 && (
              <div className="ctest-progress-bar">
                <div
                  className={`ctest-progress-fill ${runState.failed > 0 ? "has-failures" : ""}`}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* Test results table */}
        {runState && runState.tests.length > 0 && (
          <div className="ctest-results-table">
            <div className="ctest-results-header">
              <span className="ctest-results-col-status">Status</span>
              <span className="ctest-results-col-name">Test</span>
              <span className="ctest-results-col-duration">Duration</span>
            </div>
            <div className="ctest-results-body">
              {runState.tests.map((t) => {
                const hasError = t.status === "failed" && t.output.length > 0;
                const isExpanded = expandedFailure === t.index;

                return (
                  <div
                    key={t.index}
                    className={`ctest-result-row ctest-result-${t.status} ${hasError ? "clickable" : ""} ${isExpanded ? "expanded" : ""}`}
                    onClick={() => {
                      if (hasError) {
                        setExpandedFailure(isExpanded ? null : t.index);
                      }
                    }}
                  >
                    <span className="ctest-results-col-status">
                      <TestStatusIcon status={t.status} />
                    </span>
                    <span className="ctest-results-col-name" title={`[${t.project}] ${t.file} › ${t.title}`}>
                      {t.title}
                    </span>
                    <span className="ctest-results-col-duration">{t.duration}</span>
                    {isExpanded && t.output.length > 0 && (
                      <div className="ctest-failure-output" onClick={(e) => e.stopPropagation()}>
                        {t.output.map((line, li) => (
                          <div key={li} className="ctest-failure-line">{line}</div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Waiting states */}
        {runState && runState.phase === "running" && runState.tests.length === 0 && (
          <div className="text-center py-8 text-muted">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Starting tests...
          </div>
        )}
        {!runState && (
          <div className="text-center py-8 text-muted">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Starting...
          </div>
        )}

        {/* Raw output toggle */}
        <div className="ctest-raw-toggle">
          <button
            className="btn-secondary btn-sm"
            onClick={() => setShowRawOutput(!showRawOutput)}
          >
            {showRawOutput ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Raw Output
          </button>
        </div>
        {showRawOutput && activeJob.output && (
          <div className="ctest-raw-output">
            {activeJob.output.map((line, i) => (
              <div key={i} className="ctest-raw-line">{line}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Specs View (default) ──────────────────────────────────────────────

  return (
    <div className="ctest-page">
      <div className="ctest-run-header">
        <div className="ctest-run-header-left">
          <MonitorCheck className="w-5 h-5" />
          <span className="ctest-run-title">Playwright</span>
          <span className="badge badge-gray">{specs.length} specs</span>
        </div>
        <div className="ctest-run-header-right">
          <button
            className="btn-primary btn-sm"
            onClick={() => {
              if (selectedSpecs.size > 0) {
                runTests(Array.from(selectedSpecs));
              } else {
                runTests();
              }
            }}
          >
            <Play className="w-4 h-4" />
            {selectedSpecs.size > 0 ? `Run ${selectedSpecs.size} Specs` : "Run All"}
          </button>
        </div>
      </div>

      <div className="ctest-toolbar">
        <div className="ctest-search">
          <Search className="w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder="Filter specs..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="ctest-search-input"
          />
        </div>
        <div className="ctest-toolbar-actions">
          <select
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className="pw-project-select"
          >
            <option value="all">All Projects</option>
            <option value="auth">Auth</option>
            <option value="noauth">No Auth</option>
          </select>
          <button
            className="btn-secondary btn-sm"
            onClick={() => setSelectedSpecs(new Set(filteredSpecs.map((s) => s.file)))}
          >
            Select All
          </button>
          <button className="btn-secondary btn-sm" onClick={() => setSelectedSpecs(new Set())}>
            Clear
          </button>
        </div>
      </div>

      {filteredSpecs.length === 0 ? (
        <div className="empty-state">
          <MonitorCheck className="w-12 h-12 text-muted" />
          <h3>No specs found</h3>
          <p className="text-muted">
            {filter ? `No specs match "${filter}"` : "No Playwright spec files found"}
          </p>
        </div>
      ) : (
        <div className="ctest-test-list">
          {filteredSpecs.map((s) => (
            <div
              key={s.file}
              className={`ctest-test-item ${selectedSpecs.has(s.file) ? "selected" : ""}`}
              onClick={() => toggleSpec(s.file)}
            >
              <input
                type="checkbox"
                checked={selectedSpecs.has(s.file)}
                onChange={() => toggleSpec(s.file)}
                onClick={(e) => e.stopPropagation()}
              />
              <span className="ctest-test-name">{s.name}</span>
              <span className={`badge badge-sm ${s.project === "auth" ? "badge-blue" : "badge-gray"}`}>
                {s.project}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helper Components ─────────────────────────────────────────────────

function TestStatusIcon({ status }: { status: PwTestResult["status"] }) {
  switch (status) {
    case "passed":
      return <CheckCircle className="w-4 h-4 ctest-icon-passed" />;
    case "failed":
      return <XCircle className="w-4 h-4 ctest-icon-failed" />;
    case "skipped":
      return <MinusCircle className="w-4 h-4 ctest-icon-skipped" />;
    case "running":
      return <Loader2 className="w-4 h-4 animate-spin ctest-icon-running" />;
    case "pending":
      return <CircleDot className="w-4 h-4 ctest-icon-pending" />;
  }
}

function ElapsedTime({ startedAt, done }: { startedAt: number; done: boolean }) {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    const update = () => {
      const ms = Date.now() - startedAt;
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      setElapsed(m > 0 ? `${m}m ${s % 60}s` : `${s}s`);
    };
    update();
    if (!done) {
      const interval = setInterval(update, 1000);
      return () => clearInterval(interval);
    }
  }, [startedAt, done]);

  return <>{elapsed}</>;
}

function getStatusBadge(status: string) {
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
    default:
      return null;
  }
}
