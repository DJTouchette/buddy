import React, { useEffect, useRef, useState, useCallback } from "react";
import { X, Square, Maximize2, Minimize2, CheckCircle, XCircle, Loader2, ChevronUp, ChevronDown, ArrowDown, Save } from "lucide-react";

interface Job {
  id: string;
  type: string;
  target: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  output: string[];
  startedAt: number;
  completedAt: number | null;
  error: string | null;
}

interface JobOutputProps {
  job: Job;
  onClose: () => void;
  onCancel: () => void;
  onComplete?: () => void;
  lambdaName?: string; // For attaching saved logs to a lambda
}

export function JobOutput({ job, onClose, onCancel, onComplete, lambdaName }: JobOutputProps) {
  const [output, setOutput] = useState<string[]>(job.output || []);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [status, setStatus] = useState(job.status);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onCompleteRef = useRef(onComplete);

  // Keep ref updated
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    // Set up SSE connection
    const eventSource = new EventSource(`/api/jobs/${job.id}/output`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.line) {
          setOutput((prev) => [...prev, data.line]);
        }

        if (data.done) {
          setStatus(data.status);
          eventSource.close();
          onCompleteRef.current?.();
        }
      } catch (err) {
        console.error("Failed to parse SSE data:", err);
      }
    };

    eventSource.onerror = () => {
      // Connection closed or error - refetch job status
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [job.id]);

  // Auto-scroll to bottom only when autoScroll is enabled
  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, autoScroll]);

  // Handle scroll to detect if user scrolled up
  const handleScroll = useCallback(() => {
    if (!outputRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    // Consider "at bottom" if within 50px of the bottom
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;

    if (isAtBottom && !autoScroll) {
      setAutoScroll(true);
    } else if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    }
  }, [autoScroll]);

  const scrollToBottom = useCallback(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
      setAutoScroll(true);
    }
  }, []);

  const handleSaveLog = async () => {
    if (!lambdaName || !saveName.trim()) return;

    setSaving(true);
    try {
      // Get selected text or all output
      const selection = window.getSelection();
      const selectedText = selection && selection.toString().trim();
      const content = selectedText || output.join("\n");

      const res = await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lambdaName,
          name: saveName.trim(),
          content,
        }),
      });

      if (res.ok) {
        setSaveSuccess(true);
        setShowSaveDialog(false);
        setSaveName("");
        // Auto-hide success message after 3 seconds
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err) {
      console.error("Failed to save log:", err);
    } finally {
      setSaving(false);
    }
  };

  const openSaveDialog = () => {
    // Generate default name with timestamp
    const now = new Date();
    const timestamp = now.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    setSaveName(timestamp);
    setShowSaveDialog(true);
  };

  const isRunning = status === "pending" || status === "running";
  const isSuccess = status === "completed";
  const isFailed = status === "failed" || status === "cancelled";
  const canSave = lambdaName && output.length > 0;

  const getStatusIcon = () => {
    if (isRunning) return <Loader2 className="w-5 h-5 animate-spin text-blue-500" />;
    if (isSuccess) return <CheckCircle className="w-5 h-5 status-success" />;
    if (isFailed) return <XCircle className="w-5 h-5 status-error" />;
    return null;
  };

  const getStatusLabel = () => {
    switch (status) {
      case "pending":
        return "Pending...";
      case "running":
        return `Running ${job.type}...`;
      case "completed":
        return "Completed";
      case "failed":
        return "Failed";
      case "cancelled":
        return "Cancelled";
      default:
        return status;
    }
  };

  const getStatusBadge = () => {
    if (isRunning) return null;
    if (isSuccess) {
      return <span className="badge badge-green">Completed</span>;
    }
    if (status === "failed") {
      return <span className="badge badge-red">Failed</span>;
    }
    if (status === "cancelled") {
      return <span className="badge badge-gray">Cancelled</span>;
    }
    return null;
  };

  return (
    <div className={`job-output-panel ${isExpanded ? "expanded" : ""} ${isMinimized ? "minimized" : ""}`}>
      <div className="job-output-header" onClick={() => isMinimized && setIsMinimized(false)}>
        <div className="job-output-title">
          {getStatusIcon()}
          <span className="job-output-label">
            {job.type}: {job.target}
          </span>
          {isMinimized ? getStatusBadge() : <span className="job-output-status">{getStatusLabel()}</span>}
          {saveSuccess && <span className="badge badge-green ml-2">Saved!</span>}
        </div>
        <div className="job-output-actions">
          {canSave && (
            <button
              className="btn-sm btn-secondary"
              onClick={(e) => {
                e.stopPropagation();
                openSaveDialog();
              }}
              title="Save log (select text to save only selection)"
            >
              <Save className="w-3 h-3" />
              Save
            </button>
          )}
          {isRunning && (
            <button className="btn-sm btn-danger" onClick={onCancel} title="Cancel job">
              <Square className="w-3 h-3" />
              Cancel
            </button>
          )}
          {!isRunning && getStatusBadge()}
          <button
            className="btn-icon-sm"
            onClick={(e) => {
              e.stopPropagation();
              setIsMinimized(!isMinimized);
            }}
            title={isMinimized ? "Show output" : "Minimize"}
          >
            {isMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {!isMinimized && (
            <button
              className="btn-icon-sm"
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? "Restore" : "Maximize"}
            >
              {isExpanded ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </button>
          )}
          <button className="btn-icon-sm" onClick={onClose} title="Dismiss">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Progress bar */}
          {isRunning && job.progress > 0 && (
            <div className="job-output-progress">
              <div
                className="job-output-progress-bar"
                style={{ width: `${job.progress}%` }}
              />
            </div>
          )}

          {/* Save dialog */}
          {showSaveDialog && (
            <div className="job-output-save-dialog">
              <input
                type="text"
                placeholder="Log name..."
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveLog();
                  if (e.key === "Escape") setShowSaveDialog(false);
                }}
              />
              <button
                className="btn-sm btn-primary"
                onClick={handleSaveLog}
                disabled={saving || !saveName.trim()}
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : "Save"}
              </button>
              <button
                className="btn-sm btn-secondary"
                onClick={() => setShowSaveDialog(false)}
              >
                Cancel
              </button>
              <span className="text-muted text-xs">
                {window.getSelection()?.toString().trim() ? "Saving selection" : "Saving all output"}
              </span>
            </div>
          )}

          {/* Output content */}
          <div className="job-output-content" ref={outputRef} onScroll={handleScroll}>
            {output.map((line, i) => (
              <LogLine key={i} line={line} />
            ))}
            {isRunning && <div className="job-output-cursor">_</div>}
          </div>

          {/* Jump to bottom button - shown when auto-scroll is disabled */}
          {!autoScroll && (
            <button
              className="job-output-jump-bottom"
              onClick={scrollToBottom}
              title="Jump to bottom"
            >
              <ArrowDown className="w-4 h-4" />
              Jump to bottom
            </button>
          )}
        </>
      )}
    </div>
  );
}

function getLineClass(line: string): string {
  if (line.startsWith("✓") || line.includes("Success")) return "output-success";
  if (line.startsWith("✗") || line.includes("Error") || line.includes("failed")) return "output-error";
  if (line.startsWith(">") || line.startsWith("===")) return "output-command";
  if (line.startsWith("[stderr]")) return "output-error";
  return "";
}

// Enhanced log line component with syntax highlighting
export function LogLine({ line }: { line: string }) {
  const parts = parseLogLine(line);
  return (
    <div className={`log-line ${parts.lineClass}`}>
      {parts.segments.map((seg, i) => (
        <span key={i} className={seg.className}>{seg.text}</span>
      ))}
    </div>
  );
}

interface LogSegment {
  text: string;
  className: string;
}

interface ParsedLine {
  lineClass: string;
  segments: LogSegment[];
}

function parseLogLine(line: string): ParsedLine {
  const segments: LogSegment[] = [];
  let lineClass = "";

  // Check for build output patterns first
  if (line.startsWith("✓")) {
    return { lineClass: "log-success", segments: [{ text: line, className: "log-success-text" }] };
  }
  if (line.startsWith("✗")) {
    return { lineClass: "log-error", segments: [{ text: line, className: "log-error-text" }] };
  }
  if (line.startsWith(">") || line.startsWith("===")) {
    return { lineClass: "log-command", segments: [{ text: line, className: "log-command-text" }] };
  }
  if (line.startsWith("[stderr]")) {
    return { lineClass: "log-error", segments: [{ text: line, className: "log-error-text" }] };
  }

  // Lambda START/END/REPORT markers
  if (line.startsWith("START RequestId:") || line.startsWith("END RequestId:")) {
    return { lineClass: "log-lambda-marker", segments: [{ text: line, className: "log-lambda-marker-text" }] };
  }
  if (line.startsWith("REPORT RequestId:")) {
    return { lineClass: "log-lambda-report", segments: parseReportLine(line) };
  }

  // Try to parse CloudWatch log format: TIMESTAMP REQUEST_ID LEVEL MESSAGE
  // Example: 2024-01-15T10:30:00.123Z abc-123 INFO Some message
  const cwMatch = line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+([a-f0-9-]+)\s+(INFO|WARN|ERROR|DEBUG|TRACE)?\s*(.*)$/i);
  if (cwMatch) {
    const [, timestamp, requestId, level, message] = cwMatch;
    segments.push({ text: timestamp + " ", className: "log-timestamp" });
    segments.push({ text: requestId + " ", className: "log-request-id" });
    if (level) {
      segments.push({ text: level + " ", className: `log-level-${level.toLowerCase()}` });
      if (level.toUpperCase() === "ERROR") lineClass = "log-error-line";
      if (level.toUpperCase() === "WARN") lineClass = "log-warn-line";
    }
    segments.push(...parseMessageContent(message));
    return { lineClass, segments };
  }

  // Try simpler timestamp format: TIMESTAMP LEVEL MESSAGE
  const simpleMatch = line.match(/^(\d{4}-\d{2}-\d{2}[\sT][\d:.,]+(?:Z|[+-]\d{2}:?\d{2})?)\s+(INFO|WARN|ERROR|DEBUG|TRACE)?\s*(.*)$/i);
  if (simpleMatch) {
    const [, timestamp, level, message] = simpleMatch;
    segments.push({ text: timestamp + " ", className: "log-timestamp" });
    if (level) {
      segments.push({ text: level + " ", className: `log-level-${level.toLowerCase()}` });
      if (level.toUpperCase() === "ERROR") lineClass = "log-error-line";
      if (level.toUpperCase() === "WARN") lineClass = "log-warn-line";
    }
    segments.push(...parseMessageContent(message));
    return { lineClass, segments };
  }

  // Check for standalone log levels at start
  const levelMatch = line.match(/^(INFO|WARN|ERROR|DEBUG|TRACE)[:\s]+(.*)$/i);
  if (levelMatch) {
    const [, level, message] = levelMatch;
    segments.push({ text: level + " ", className: `log-level-${level.toLowerCase()}` });
    if (level.toUpperCase() === "ERROR") lineClass = "log-error-line";
    if (level.toUpperCase() === "WARN") lineClass = "log-warn-line";
    segments.push(...parseMessageContent(message));
    return { lineClass, segments };
  }

  // Check if entire line is JSON
  if ((line.startsWith("{") && line.endsWith("}")) || (line.startsWith("[") && line.endsWith("]"))) {
    return { lineClass: "log-json-line", segments: [{ text: line, className: "log-json" }] };
  }

  // Check for error keywords
  if (/error|exception|failed|failure/i.test(line)) {
    lineClass = "log-error-line";
  }

  // Default: parse for inline JSON and other patterns
  segments.push(...parseMessageContent(line));
  return { lineClass, segments };
}

function parseReportLine(line: string): LogSegment[] {
  const segments: LogSegment[] = [];
  // REPORT RequestId: xxx Duration: xxx ms Billed Duration: xxx ms Memory Size: xxx MB Max Memory Used: xxx MB
  const parts = line.split(/\t/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith("REPORT")) {
      segments.push({ text: trimmed + "\t", className: "log-report-header" });
    } else if (trimmed.includes("Duration:")) {
      segments.push({ text: trimmed + "\t", className: "log-report-duration" });
    } else if (trimmed.includes("Memory")) {
      segments.push({ text: trimmed + "\t", className: "log-report-memory" });
    } else if (trimmed.includes("Init")) {
      segments.push({ text: trimmed + "\t", className: "log-report-init" });
    } else {
      segments.push({ text: trimmed + "\t", className: "log-report-other" });
    }
  }

  return segments;
}

function parseMessageContent(message: string): LogSegment[] {
  const segments: LogSegment[] = [];

  // Find JSON objects/arrays in the message
  let remaining = message;
  let lastIndex = 0;

  // Pattern to find JSON-like structures
  const jsonPattern = /(\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}|\[[^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*\])/g;
  let match;

  while ((match = jsonPattern.exec(message)) !== null) {
    // Add text before JSON
    if (match.index > lastIndex) {
      const beforeText = message.slice(lastIndex, match.index);
      segments.push(...highlightKeywords(beforeText));
    }

    // Add JSON
    segments.push({ text: match[1], className: "log-json" });
    lastIndex = match.index + match[1].length;
  }

  // Add remaining text
  if (lastIndex < message.length) {
    segments.push(...highlightKeywords(message.slice(lastIndex)));
  }

  if (segments.length === 0) {
    segments.push({ text: message, className: "" });
  }

  return segments;
}

function highlightKeywords(text: string): LogSegment[] {
  if (!text) return [];

  const segments: LogSegment[] = [];

  // Pattern for various highlightable items
  const pattern = /(https?:\/\/[^\s]+|"[^"]*"|\b\d+(?:\.\d+)?(?:ms|s|MB|KB|GB|%)\b|\b[A-Z][A-Z0-9_]{2,}\b|\btrue\b|\bfalse\b|\bnull\b|\bundefined\b)/g;

  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), className: "" });
    }

    const value = match[1];
    let className = "";

    if (value.startsWith("http")) {
      className = "log-url";
    } else if (value.startsWith('"')) {
      className = "log-string";
    } else if (/^\d/.test(value)) {
      className = "log-number";
    } else if (value === "true" || value === "false") {
      className = "log-boolean";
    } else if (value === "null" || value === "undefined") {
      className = "log-null";
    } else {
      className = "log-constant";
    }

    segments.push({ text: value, className });
    lastIndex = match.index + value.length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), className: "" });
  }

  return segments.length > 0 ? segments : [{ text, className: "" }];
}
