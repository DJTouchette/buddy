import React, { useState } from "react";
import {
  Loader2,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  ChevronRight,
  ChevronDown,
  FlaskConical,
  MinusCircle,
  ExternalLink,
} from "lucide-react";
import { useApi } from "../hooks/useApi";

interface TestRun {
  id: number;
  name: string;
  state: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  startedDate: string;
  completedDate: string;
  buildId: number;
  buildNumber: string;
  buildResult?: string;
  buildUrl: string;
  webAccessUrl: string;
}

interface TestResult {
  id: number;
  testCaseTitle: string;
  outcome: string;
  durationInMs: number;
  errorMessage?: string;
  stackTrace?: string;
  automatedTestName: string;
}

interface RunsResponse {
  runs: TestRun[];
  error?: string;
}

export function E2EPage() {
  const { data, loading, error, refetch } = useApi<RunsResponse>("/api/e2e/runs");
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, TestResult[]>>({});
  const [loadingResults, setLoadingResults] = useState<number | null>(null);
  const [expandedError, setExpandedError] = useState<number | null>(null);

  const toggleRun = async (runId: number) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }

    setExpandedRunId(runId);

    if (!results[runId]) {
      setLoadingResults(runId);
      try {
        const res = await fetch(`/api/e2e/runs/${runId}/results`);
        const data = await res.json();
        setResults((prev) => ({ ...prev, [runId]: data.results || [] }));
      } catch (err) {
        console.error("Failed to fetch results:", err);
      } finally {
        setLoadingResults(null);
      }
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getRunDuration = (run: TestRun) => {
    if (!run.startedDate || !run.completedDate) return "—";
    const ms = new Date(run.completedDate).getTime() - new Date(run.startedDate).getTime();
    return formatDuration(ms);
  };

  const getRunStatus = (run: TestRun) => {
    if (run.state === "InProgress" || run.state === "Waiting") return "running";
    if (run.failedTests > 0) return "failed";
    if (run.passedTests === run.totalTests && run.totalTests > 0) return "passed";
    return "completed";
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-muted">
        <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
        Loading E2E test runs...
      </div>
    );
  }

  if (error) {
    return (
      <div className="empty-state">
        <XCircle className="w-12 h-12 text-muted" />
        <h3>Error loading E2E results</h3>
        <p className="text-muted">{error}</p>
        <button className="btn-primary" onClick={refetch}>
          Retry
        </button>
      </div>
    );
  }

  const runs = data?.runs || [];

  return (
    <div className="e2e-page">
      <div className="e2e-header">
        <div className="e2e-header-left">
          <FlaskConical className="w-5 h-5" />
          <span className="e2e-title">E2E Test Results</span>
          <span className="badge badge-gray">{runs.length} runs</span>
        </div>
        <div className="e2e-header-right">
          <button className="btn-secondary btn-sm" onClick={refetch}>
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="empty-state">
          <FlaskConical className="w-12 h-12 text-muted" />
          <h3>No E2E test runs found</h3>
          <p className="text-muted">
            No test runs were found for the code-quality-e2e pipeline.
          </p>
        </div>
      ) : (
        <div className="e2e-run-list">
          {runs.map((run) => {
            const status = getRunStatus(run);
            const isExpanded = expandedRunId === run.id;
            const runResults = results[run.id];

            return (
              <div key={run.id} className={`e2e-run-card ${isExpanded ? "expanded" : ""}`}>
                <div className="e2e-run-card-header" onClick={() => toggleRun(run.id)}>
                  <div className="e2e-run-card-left">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-muted" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-muted" />
                    )}
                    <RunStatusBadge status={status} />
                    <div className="e2e-run-info">
                      <span className="e2e-run-name">{run.name || `Run #${run.id}`}</span>
                      <span className="e2e-run-date">{formatDate(run.startedDate)}</span>
                    </div>
                  </div>
                  <div className="e2e-run-card-right">
                    <div className="e2e-run-counts">
                      {run.passedTests > 0 && (
                        <span className="e2e-count e2e-count-passed">
                          <CheckCircle className="w-3.5 h-3.5" />
                          {run.passedTests}
                        </span>
                      )}
                      {run.failedTests > 0 && (
                        <span className="e2e-count e2e-count-failed">
                          <XCircle className="w-3.5 h-3.5" />
                          {run.failedTests}
                        </span>
                      )}
                      {run.totalTests - run.passedTests - run.failedTests > 0 && (
                        <span className="e2e-count e2e-count-other">
                          <MinusCircle className="w-3.5 h-3.5" />
                          {run.totalTests - run.passedTests - run.failedTests}
                        </span>
                      )}
                      <span className="e2e-count e2e-count-total">{run.totalTests} total</span>
                    </div>
                    <span className="e2e-run-duration">
                      <Clock className="w-3.5 h-3.5" />
                      {getRunDuration(run)}
                    </span>
                    <a
                      href={run.buildUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-icon btn-sm"
                      onClick={(e) => e.stopPropagation()}
                      title="View in Azure DevOps"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </div>

                {isExpanded && (
                  <div className="e2e-run-details">
                    {loadingResults === run.id ? (
                      <div className="text-center py-4 text-muted">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto mb-1" />
                        Loading test results...
                      </div>
                    ) : runResults && runResults.length > 0 ? (
                      <div className="e2e-results-table">
                        <div className="e2e-results-header">
                          <span className="e2e-results-col-status">Status</span>
                          <span className="e2e-results-col-name">Test</span>
                          <span className="e2e-results-col-duration">Duration</span>
                        </div>
                        <div className="e2e-results-body">
                          {runResults.map((result) => {
                            const hasError = result.outcome === "Failed" && (result.errorMessage || result.stackTrace);
                            const isErrorExpanded = expandedError === result.id;

                            return (
                              <div
                                key={result.id}
                                className={`e2e-result-row e2e-result-${result.outcome.toLowerCase()} ${hasError ? "clickable" : ""} ${isErrorExpanded ? "expanded" : ""}`}
                                onClick={() => {
                                  if (hasError) {
                                    setExpandedError(isErrorExpanded ? null : result.id);
                                  }
                                }}
                              >
                                <span className="e2e-results-col-status">
                                  <OutcomeIcon outcome={result.outcome} />
                                </span>
                                <span className="e2e-results-col-name" title={result.automatedTestName}>
                                  {result.testCaseTitle}
                                </span>
                                <span className="e2e-results-col-duration">
                                  {formatDuration(result.durationInMs)}
                                </span>
                                {isErrorExpanded && (
                                  <div className="e2e-error-output" onClick={(e) => e.stopPropagation()}>
                                    {result.errorMessage && (
                                      <div className="e2e-error-message">{result.errorMessage}</div>
                                    )}
                                    {result.stackTrace && (
                                      <pre className="e2e-stack-trace">{result.stackTrace}</pre>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4 text-muted">No test results available</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RunStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "passed":
      return <span className="badge badge-green">Passed</span>;
    case "failed":
      return <span className="badge badge-red">Failed</span>;
    case "running":
      return (
        <span className="badge badge-blue">
          <Loader2 className="w-3 h-3 animate-spin" />
          Running
        </span>
      );
    default:
      return <span className="badge badge-gray">Completed</span>;
  }
}

function OutcomeIcon({ outcome }: { outcome: string }) {
  switch (outcome) {
    case "Passed":
      return <CheckCircle className="w-4 h-4 ctest-icon-passed" />;
    case "Failed":
      return <XCircle className="w-4 h-4 ctest-icon-failed" />;
    default:
      return <MinusCircle className="w-4 h-4 ctest-icon-skipped" />;
  }
}
