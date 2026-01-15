import React, { useEffect, useState } from "react";
import {
  X,
  Play,
  Rocket,
  Loader2,
  Server,
  Clock,
  HardDrive,
  Code,
  Calendar,
  FileCode,
  ChevronDown,
  ChevronRight,
  ScrollText,
  FileText,
  Trash2,
  ShieldAlert,
} from "lucide-react";
import { LogLine } from "./JobOutput";

interface AwsLambdaInfo {
  functionName: string;
  localName: string | null;
  runtime: string | null;
  memorySize: number | null;
  timeout: number | null;
  lastModified: string | null;
  codeSize: number | null;
  handler: string | null;
  description: string | null;
  environment: string | null;
  stackType: string | null;
}

interface SavedLog {
  id: string;
  lambdaName: string;
  name: string;
  content: string;
  createdAt: number;
}

interface LambdaDetailModalProps {
  lambda: AwsLambdaInfo;
  onClose: () => void;
  onBuild: (localName: string) => void;
  onDeploy: (localName: string, awsFunctionName: string) => void;
  onTailLogs: (awsFunctionName: string, lambdaName?: string) => void;
  isJobRunning: boolean;
  localLambdas: string[];
  isEnvProtected?: boolean;
  currentEnv?: string | null;
}

export function LambdaDetailModal({
  lambda,
  onClose,
  onBuild,
  onDeploy,
  onTailLogs,
  isJobRunning,
  localLambdas,
  isEnvProtected = false,
  currentEnv,
}: LambdaDetailModalProps) {
  const [details, setDetails] = useState<{
    config: AwsLambdaInfo;
    envVars: Record<string, string>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEnvVars, setShowEnvVars] = useState(false);
  const [showSavedLogs, setShowSavedLogs] = useState(false);
  const [savedLogs, setSavedLogs] = useState<SavedLog[]>([]);
  const [savedLogsLoading, setSavedLogsLoading] = useState(false);
  const [viewingLog, setViewingLog] = useState<SavedLog | null>(null);

  // Case-insensitive match for local lambda name
  const matchedLocalName = lambda.localName
    ? localLambdas.find((l) => l.toLowerCase() === lambda.localName?.toLowerCase())
    : null;
  const hasLocalMatch = !!matchedLocalName;

  // The name to use for saving logs
  const logLambdaName = lambda.localName || lambda.functionName;

  useEffect(() => {
    fetchDetails();
    fetchSavedLogs();
  }, [lambda.functionName]);

  const fetchDetails = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/infra/aws-lambdas/${encodeURIComponent(lambda.functionName)}`);
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        setDetails(data);
      }
    } catch (err) {
      setError("Failed to fetch lambda details");
    } finally {
      setLoading(false);
    }
  };

  const fetchSavedLogs = async () => {
    setSavedLogsLoading(true);
    try {
      const res = await fetch(`/api/logs/${encodeURIComponent(logLambdaName)}`);
      const data = await res.json();
      setSavedLogs(data.logs || []);
    } catch (err) {
      console.error("Failed to fetch saved logs:", err);
    } finally {
      setSavedLogsLoading(false);
    }
  };

  const deleteLog = async (logId: string) => {
    try {
      const res = await fetch(`/api/logs/delete/${logId}`, { method: "POST" });
      if (res.ok) {
        setSavedLogs((prev) => prev.filter((l) => l.id !== logId));
        if (viewingLog?.id === logId) {
          setViewingLog(null);
        }
      }
    } catch (err) {
      console.error("Failed to delete log:", err);
    }
  };

  const formatBytes = (bytes: number | null) => {
    if (bytes === null) return "N/A";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "N/A";
    return new Date(dateStr).toLocaleString();
  };

  // If viewing a log, show log viewer
  if (viewingLog) {
    return (
      <div className="modal-overlay" onClick={() => setViewingLog(null)}>
        <div className="modal-content lambda-detail-modal log-viewer-modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <div>
              <h2>{viewingLog.name}</h2>
              <p className="text-muted text-sm">
                {logLambdaName} - {new Date(viewingLog.createdAt).toLocaleString()}
              </p>
            </div>
            <button className="btn-icon" onClick={() => setViewingLog(null)}>
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="log-viewer-content">
            {viewingLog.content.split("\n").map((line, i) => (
              <LogLine key={i} line={line} />
            ))}
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setViewingLog(null)}>
              Back
            </button>
            <button
              className="btn-danger"
              onClick={() => deleteLog(viewingLog.id)}
            >
              <Trash2 className="w-4 h-4" />
              Delete Log
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content lambda-detail-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{lambda.localName || lambda.functionName}</h2>
            {lambda.localName && (
              <p className="text-muted text-sm">{lambda.functionName}</p>
            )}
          </div>
          <button className="btn-icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="modal-loading">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span>Loading details...</span>
          </div>
        ) : error ? (
          <div className="alert alert-error">
            <span>{error}</span>
          </div>
        ) : (
          <>
            <div className="lambda-detail-grid">
              <div className="lambda-detail-item">
                <Server className="w-4 h-4" />
                <span className="lambda-detail-label">Runtime</span>
                <span className="lambda-detail-value">{details?.config.runtime || "N/A"}</span>
              </div>
              <div className="lambda-detail-item">
                <HardDrive className="w-4 h-4" />
                <span className="lambda-detail-label">Memory</span>
                <span className="lambda-detail-value">{details?.config.memorySize || "N/A"} MB</span>
              </div>
              <div className="lambda-detail-item">
                <Clock className="w-4 h-4" />
                <span className="lambda-detail-label">Timeout</span>
                <span className="lambda-detail-value">{details?.config.timeout || "N/A"} seconds</span>
              </div>
              <div className="lambda-detail-item">
                <FileCode className="w-4 h-4" />
                <span className="lambda-detail-label">Code Size</span>
                <span className="lambda-detail-value">{formatBytes(details?.config.codeSize || null)}</span>
              </div>
              <div className="lambda-detail-item">
                <Code className="w-4 h-4" />
                <span className="lambda-detail-label">Handler</span>
                <span className="lambda-detail-value lambda-detail-code">{details?.config.handler || "N/A"}</span>
              </div>
              <div className="lambda-detail-item">
                <Calendar className="w-4 h-4" />
                <span className="lambda-detail-label">Last Modified</span>
                <span className="lambda-detail-value">{formatDate(details?.config.lastModified || null)}</span>
              </div>
            </div>

            {details?.config.description && (
              <div className="lambda-detail-description">
                <strong>Description:</strong> {details.config.description}
              </div>
            )}

            {details?.envVars && Object.keys(details.envVars).length > 0 && (
              <div className="lambda-env-section">
                <button
                  className="lambda-env-toggle"
                  onClick={() => setShowEnvVars(!showEnvVars)}
                >
                  {showEnvVars ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  <span>Environment Variables ({Object.keys(details.envVars).length})</span>
                </button>
                {showEnvVars && (
                  <div className="lambda-env-list">
                    {Object.entries(details.envVars)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([key, value]) => (
                        <div key={key} className="lambda-env-item">
                          <span className="lambda-env-key">{key}</span>
                          <span className="lambda-env-value">{value}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            )}

            {/* Saved Logs Section */}
            <div className="lambda-env-section">
              <button
                className="lambda-env-toggle"
                onClick={() => setShowSavedLogs(!showSavedLogs)}
              >
                {showSavedLogs ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <FileText className="w-4 h-4" />
                <span>Saved Logs ({savedLogs.length})</span>
              </button>
              {showSavedLogs && (
                <div className="saved-logs-list">
                  {savedLogsLoading ? (
                    <div className="text-muted text-sm p-2">Loading...</div>
                  ) : savedLogs.length === 0 ? (
                    <div className="text-muted text-sm p-2">No saved logs yet. Use "Save" button when tailing logs.</div>
                  ) : (
                    savedLogs.map((log) => (
                      <div key={log.id} className="saved-log-item">
                        <button
                          className="saved-log-name"
                          onClick={() => setViewingLog(log)}
                        >
                          <FileText className="w-4 h-4" />
                          <span>{log.name}</span>
                        </button>
                        <span className="saved-log-date">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                        <button
                          className="btn-icon-sm btn-danger-icon"
                          onClick={() => deleteLog(log.id)}
                          title="Delete log"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {isEnvProtected && (
          <div className="alert alert-warning">
            <ShieldAlert className="w-4 h-4" />
            <span>
              Environment <strong>{currentEnv}</strong> is protected. Deployments are disabled.
            </span>
          </div>
        )}

        <div className="modal-actions">
          <button
            className="btn-secondary"
            onClick={() => {
              onTailLogs(lambda.functionName, logLambdaName);
              onClose();
            }}
            disabled={isJobRunning}
          >
            <ScrollText className="w-4 h-4" />
            Tail Logs
          </button>
          {hasLocalMatch && matchedLocalName ? (
            <>
              <button
                className="btn-secondary"
                onClick={() => onBuild(matchedLocalName)}
                disabled={isJobRunning}
              >
                <Play className="w-4 h-4" />
                Build Only
              </button>
              <button
                className="btn-primary"
                onClick={() => onDeploy(matchedLocalName, lambda.functionName)}
                disabled={isJobRunning || isEnvProtected}
                title={isEnvProtected ? `Cannot deploy to protected environment "${currentEnv}"` : undefined}
              >
                <Rocket className="w-4 h-4" />
                Build & Deploy
              </button>
            </>
          ) : (
            <p className="text-muted text-sm">
              No local handler found for this Lambda ({lambda.localName || "unknown"}). Cannot build/deploy.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
