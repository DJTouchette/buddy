import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  Loader2,
  RefreshCw,
  Play,
  CheckCircle,
  XCircle,
  Clock,
  Search,
  FlaskConical,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  SkipForward,
  StopCircle,
  CircleDot,
  MinusCircle,
} from "lucide-react";

interface TestProject {
  name: string;
  csprojPath: string;
  cachedTestCount: number;
}

interface TestItem {
  fqn: string;
  shortName: string;
}

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

interface TestResult {
  fqn: string;
  shortName: string;
  status: "pending" | "running" | "passed" | "failed" | "skipped";
  duration: string;
  output: string[];
}

interface TestRunState {
  phase: "building" | "running" | "done";
  tests: TestResult[];
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  startedAt: number;
  error: string | null;
}

type View = "projects" | "tests" | "running";

interface CTestPageProps {
  navigate: (path: string) => void;
}

export function CTestPage({ navigate }: CTestPageProps) {
  const [projects, setProjects] = useState<TestProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [projectFilter, setProjectFilter] = useState("");
  const [view, setView] = useState<View>("projects");

  // Test discovery state
  const [selectedProject, setSelectedProject] = useState<TestProject | null>(null);
  const [tests, setTests] = useState<TestItem[]>([]);
  const [testFilter, setTestFilter] = useState("");
  const [selectedTests, setSelectedTests] = useState<Set<string>>(new Set());
  const [discovering, setDiscovering] = useState(false);
  const [integration, setIntegration] = useState(true);

  // Running job state
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const activeJobRef = useRef<string | null>(null);
  const [runState, setRunState] = useState<TestRunState | null>(null);
  const [showRawOutput, setShowRawOutput] = useState(false);
  const [expandedFailure, setExpandedFailure] = useState<string | null>(null);

  // Fetch projects on mount
  useEffect(() => {
    fetchProjects();
  }, []);

  // Poll active job + test run state
  useEffect(() => {
    if (!activeJobRef.current) return;
    const interval = setInterval(() => {
      fetchActiveJob();
      fetchRunState();
    }, 800);
    return () => clearInterval(interval);
  }, [activeJob?.id]);

  const fetchProjects = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/ctest/projects");
      const data = await res.json();
      setProjects(data.projects || []);
    } catch (err) {
      console.error("Failed to fetch projects:", err);
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
    } catch {
      // ignore
    }
  };

  const fetchRunState = async () => {
    if (!activeJobRef.current) return;
    try {
      const res = await fetch(`/api/ctest/run/${activeJobRef.current}/status`);
      if (res.ok) {
        const data = await res.json();
        if (data.state) setRunState(data.state);
      }
    } catch {
      // ignore
    }
  };

  const discoverTests = async (project: TestProject, rebuild = false) => {
    setSelectedProject(project);
    setDiscovering(true);
    setTests([]);
    setSelectedTests(new Set());
    setTestFilter("");
    setView("tests");

    try {
      const url = `/api/ctest/tests/${encodeURIComponent(project.name)}${rebuild ? "?rebuild=true" : ""}`;
      const res = await fetch(url);
      const data = await res.json();
      setTests(data.tests || []);
    } catch (err) {
      console.error("Failed to discover tests:", err);
    } finally {
      setDiscovering(false);
    }
  };

  const runProjectTests = async (project: TestProject) => {
    try {
      const res = await fetch("/api/ctest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project: project.name, integration }),
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

  const runSelectedTests = async () => {
    if (!selectedProject || selectedTests.size === 0) return;
    try {
      const res = await fetch("/api/ctest/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project: selectedProject.name,
          tests: Array.from(selectedTests),
          integration,
        }),
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
    if (view === "running") {
      setActiveJob(null);
      activeJobRef.current = null;
      setRunState(null);
      if (selectedProject && tests.length > 0) {
        setView("tests");
      } else {
        setView("projects");
      }
    } else if (view === "tests") {
      setSelectedProject(null);
      setTests([]);
      setView("projects");
    }
  };

  // Filtered lists
  const filteredProjects = projectFilter
    ? projects.filter((p) => p.name.toLowerCase().includes(projectFilter.toLowerCase()))
    : projects;

  const filteredTests = testFilter
    ? tests.filter(
        (t) =>
          t.shortName.toLowerCase().includes(testFilter.toLowerCase()) ||
          t.fqn.toLowerCase().includes(testFilter.toLowerCase()),
      )
    : tests;

  const toggleTest = (fqn: string) => {
    setSelectedTests((prev) => {
      const next = new Set(prev);
      if (next.has(fqn)) next.delete(fqn);
      else next.add(fqn);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedTests(new Set(filteredTests.map((t) => t.fqn)));
  };

  const selectNone = () => {
    setSelectedTests(new Set());
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-muted">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
        Loading test projects...
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
            <FlaskConical className="w-5 h-5" />
            <span className="ctest-run-title">{activeJob.target}</span>
            {getStatusBadge(activeJob.status)}
          </div>
          <div className="ctest-run-header-right">
            {runState?.phase === "building" && (
              <span className="ctest-phase-badge ctest-phase-building">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Building...
              </span>
            )}
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
              {runState.tests.map((t, i) => (
                <div
                  key={`${i}-${t.fqn}`}
                  className={`ctest-result-row ctest-result-${t.status} ${
                    t.status === "failed" && t.output.length > 0 ? "clickable" : ""
                  } ${expandedFailure === t.fqn ? "expanded" : ""}`}
                  onClick={() => {
                    if (t.status === "failed" && t.output.length > 0) {
                      setExpandedFailure(expandedFailure === t.fqn ? null : t.fqn);
                    }
                  }}
                >
                  <span className="ctest-results-col-status">
                    <TestStatusIcon status={t.status} />
                  </span>
                  <span className="ctest-results-col-name" title={t.fqn}>
                    {t.shortName}
                  </span>
                  <span className="ctest-results-col-duration">{t.duration}</span>
                  {expandedFailure === t.fqn && t.output.length > 0 && (
                    <div className="ctest-failure-output" onClick={(e) => e.stopPropagation()}>
                      {t.output.map((line, li) => (
                        <div key={li} className="ctest-failure-line">{line}</div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Building state with no tests yet */}
        {runState && runState.phase === "building" && runState.tests.length === 0 && (
          <div className="text-center py-8 text-muted">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Building project...
          </div>
        )}

        {/* No state yet (just submitted) */}
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

  // ── Tests View (drill-down) ──────────────────────────────────────────

  if (view === "tests" && selectedProject) {
    return (
      <div className="ctest-page">
        <div className="ctest-run-header">
          <div className="ctest-run-header-left">
            <button className="btn-icon" onClick={goBack} title="Back">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <FlaskConical className="w-5 h-5" />
            <span className="ctest-run-title">{selectedProject.name}</span>
            <span className="badge badge-gray">{tests.length} tests</span>
          </div>
          <div className="ctest-run-header-right">
            <button
              className="btn-secondary btn-sm"
              onClick={() => discoverTests(selectedProject, true)}
              disabled={discovering}
            >
              <RefreshCw className={`w-4 h-4 ${discovering ? "animate-spin" : ""}`} />
              Rebuild
            </button>
            <button
              className="btn-primary btn-sm"
              onClick={runSelectedTests}
              disabled={selectedTests.size === 0}
            >
              <Play className="w-4 h-4" />
              Run {selectedTests.size > 0 ? `${selectedTests.size} Tests` : "Selected"}
            </button>
          </div>
        </div>

        {discovering ? (
          <div className="text-center py-8 text-muted">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            Discovering tests...
          </div>
        ) : (
          <>
            <div className="ctest-toolbar">
              <div className="ctest-search">
                <Search className="w-4 h-4 text-muted" />
                <input
                  type="text"
                  placeholder="Filter tests..."
                  value={testFilter}
                  onChange={(e) => setTestFilter(e.target.value)}
                  className="ctest-search-input"
                />
              </div>
              <div className="ctest-toolbar-actions">
                <button className="btn-secondary btn-sm" onClick={selectAll}>
                  Select All ({filteredTests.length})
                </button>
                <button className="btn-secondary btn-sm" onClick={selectNone}>
                  Clear
                </button>
                <label className="ctest-toggle">
                  <input
                    type="checkbox"
                    checked={integration}
                    onChange={(e) => setIntegration(e.target.checked)}
                  />
                  Integration
                </label>
              </div>
            </div>

            <div className="ctest-test-list">
              {filteredTests.map((t, i) => (
                <div
                  key={`${i}-${t.fqn}`}
                  className={`ctest-test-item ${selectedTests.has(t.fqn) ? "selected" : ""}`}
                  onClick={() => toggleTest(t.fqn)}
                >
                  <input
                    type="checkbox"
                    checked={selectedTests.has(t.fqn)}
                    onChange={() => toggleTest(t.fqn)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="ctest-test-name" title={t.fqn}>
                    {t.shortName}
                  </span>
                </div>
              ))}
              {filteredTests.length === 0 && testFilter && (
                <div className="text-center py-4 text-muted">
                  No tests match "{testFilter}"
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // ── Projects View (default) ──────────────────────────────────────────

  return (
    <div className="ctest-page">
      <div className="ctest-run-header">
        <div className="ctest-run-header-left">
          <FlaskConical className="w-5 h-5" />
          <span className="ctest-run-title">C# Tests</span>
          <span className="badge badge-gray">{projects.length} projects</span>
        </div>
        <div className="ctest-run-header-right">
          <label className="ctest-toggle">
            <input
              type="checkbox"
              checked={integration}
              onChange={(e) => setIntegration(e.target.checked)}
            />
            Integration
          </label>
          <button className="btn-secondary btn-sm" onClick={fetchProjects}>
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      <div className="ctest-toolbar">
        <div className="ctest-search">
          <Search className="w-4 h-4 text-muted" />
          <input
            type="text"
            placeholder="Filter projects..."
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
            className="ctest-search-input"
            autoFocus
          />
        </div>
      </div>

      {filteredProjects.length === 0 ? (
        <div className="empty-state">
          <FlaskConical className="w-12 h-12 text-muted" />
          <h3>No test projects found</h3>
          <p className="text-muted">
            {projectFilter ? `No projects match "${projectFilter}"` : "No .Tests projects found in backend.sln"}
          </p>
        </div>
      ) : (
        <div className="ctest-project-list">
          {filteredProjects.map((project) => (
            <div key={project.name} className="ctest-project-card">
              <div className="ctest-project-info">
                <span className="ctest-project-name">{project.name}</span>
                {project.cachedTestCount > 0 && (
                  <span className="badge badge-gray badge-sm">
                    {project.cachedTestCount} tests
                  </span>
                )}
              </div>
              <div className="ctest-project-actions">
                <button
                  className="btn-secondary btn-sm"
                  onClick={() => discoverTests(project)}
                  title="Drill into individual tests"
                >
                  <Search className="w-3.5 h-3.5" />
                  Drill
                </button>
                <button
                  className="btn-primary btn-sm"
                  onClick={() => runProjectTests(project)}
                  title="Run all tests in project"
                >
                  <Play className="w-3.5 h-3.5" />
                  Run
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helper Components ─────────────────────────────────────────────────

function TestStatusIcon({ status }: { status: TestResult["status"] }) {
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
