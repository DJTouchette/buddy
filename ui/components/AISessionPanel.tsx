import React, { useEffect, useRef, useState, useCallback } from "react";
import { X, Copy, Terminal, StopCircle, Loader2, CheckCircle, XCircle, ArrowDown } from "lucide-react";
import { Markdown } from "./Markdown";

interface AIStreamEvent {
  type: "status" | "session_id" | "assistant_text" | "tool_use" | "result" | "error" | "file_created";
  message?: string;
  sessionId?: string;
  text?: string;
  toolName?: string;
  toolInput?: string;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  filePath?: string;
}

interface AISessionPanelProps {
  jobId: string;
  ticketKey: string;
  onClose: () => void;
}

type TabName = "output" | "plan" | "trace" | "start";

export function AISessionPanel({ jobId, ticketKey, onClose }: AISessionPanelProps) {
  const [events, setEvents] = useState<AIStreamEvent[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(true);
  const [jobStatus, setJobStatus] = useState<string>("running");
  const [activeTab, setActiveTab] = useState<TabName>("output");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [ticketFiles, setTicketFiles] = useState<{
    startMd: string | null;
    planMd: string | null;
    traceMd: string | null;
  }>({ startMd: null, planMd: null, traceMd: null });

  const outputRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Connect to job output SSE
  useEffect(() => {
    const eventSource = new EventSource(`/api/jobs/${jobId}/output`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);

        if (data.line) {
          // Try to parse as AIStreamEvent JSON
          try {
            const event: AIStreamEvent = JSON.parse(data.line);
            setEvents((prev) => [...prev, event]);

            if (event.type === "session_id" && event.sessionId) {
              setSessionId(event.sessionId);
            }
          } catch {
            // Not JSON, treat as plain text status line
            setEvents((prev) => [...prev, { type: "status", message: data.line }]);
          }
        }

        if (data.done) {
          setIsRunning(false);
          setJobStatus(data.status);
          eventSource.close();
        }
      } catch (err) {
        console.error("Failed to parse SSE data:", err);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [jobId]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && outputRef.current && activeTab === "output") {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [events, autoScroll, activeTab]);

  // Scroll handler
  const handleScroll = useCallback(() => {
    if (!outputRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    if (isAtBottom && !autoScroll) setAutoScroll(true);
    else if (!isAtBottom && autoScroll) setAutoScroll(false);
  }, [autoScroll]);

  const scrollToBottom = useCallback(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
      setAutoScroll(true);
    }
  }, []);

  // Poll ticket files while running
  useEffect(() => {
    const fetchFiles = async () => {
      try {
        const res = await fetch(`/api/ai/ticket-files/${ticketKey}`);
        const data = await res.json();
        setTicketFiles(data);
      } catch {}
    };

    fetchFiles();
    if (isRunning) {
      const interval = setInterval(fetchFiles, 5000);
      return () => clearInterval(interval);
    }
  }, [ticketKey, isRunning]);

  // Copy session ID
  const handleCopy = useCallback(() => {
    if (!sessionId) return;
    navigator.clipboard.writeText(sessionId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [sessionId]);

  // Copy resume command
  const handleCopyResume = useCallback(() => {
    if (!sessionId) return;
    navigator.clipboard.writeText(`claude --resume ${sessionId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [sessionId]);

  // Cancel job
  const handleCancel = useCallback(async () => {
    try {
      await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
    } catch {}
  }, [jobId]);

  // Collapse consecutive assistant_text events into single blocks for display
  const displayEvents = React.useMemo(() => {
    const collapsed: AIStreamEvent[] = [];
    let textAccum = "";

    for (const event of events) {
      if (event.type === "assistant_text") {
        textAccum += event.text || "";
      } else {
        if (textAccum) {
          collapsed.push({ type: "assistant_text", text: textAccum });
          textAccum = "";
        }
        collapsed.push(event);
      }
    }
    if (textAccum) {
      collapsed.push({ type: "assistant_text", text: textAccum });
    }
    return collapsed;
  }, [events]);

  // Get result event (last one)
  const resultEvent = events.findLast((e) => e.type === "result");
  const isDone = !isRunning;
  const isSuccess = jobStatus === "completed";
  const isFailed = jobStatus === "failed" || jobStatus === "cancelled";

  const getFileContent = (): string | null => {
    switch (activeTab) {
      case "plan": return ticketFiles.planMd;
      case "trace": return ticketFiles.traceMd;
      case "start": return ticketFiles.startMd;
      default: return null;
    }
  };

  const fileContent = getFileContent();

  return (
    <div className="ai-session-panel">
      {/* Header */}
      <div className="ai-session-header">
        <div className="ai-session-title">
          {isRunning ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : isSuccess ? (
            <CheckCircle className="w-4 h-4 status-success" />
          ) : (
            <XCircle className="w-4 h-4 status-error" />
          )}
          <span>AI Session: {ticketKey}</span>
          {isDone && (
            <span className={`badge ${isSuccess ? "badge-green" : "badge-red"}`}>
              {jobStatus}
            </span>
          )}
        </div>
        <button className="btn-icon-sm" onClick={onClose} title="Close panel">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Session ID bar */}
      {sessionId && (
        <div className="ai-session-id">
          <span className="ai-session-id-label">Session:</span>
          <code className="ai-session-id-value">{sessionId}</code>
          <button className="btn-sm btn-secondary" onClick={handleCopy} title="Copy session ID">
            <Copy className="w-3 h-3" />
            {copied ? "Copied" : "Copy"}
          </button>
          <button className="btn-sm btn-secondary" onClick={handleCopyResume} title="Copy resume command">
            <Terminal className="w-3 h-3" />
            Resume
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="ai-session-tabs">
        <button
          className={`ai-session-tab ${activeTab === "output" ? "active" : ""}`}
          onClick={() => setActiveTab("output")}
        >
          Output
          {isRunning && <Loader2 className="w-3 h-3 animate-spin" />}
        </button>
        <button
          className={`ai-session-tab ${activeTab === "plan" ? "active" : ""}`}
          onClick={() => setActiveTab("plan")}
          disabled={!ticketFiles.planMd}
        >
          Plan
          {ticketFiles.planMd && <span className="ai-tab-dot" />}
        </button>
        <button
          className={`ai-session-tab ${activeTab === "trace" ? "active" : ""}`}
          onClick={() => setActiveTab("trace")}
          disabled={!ticketFiles.traceMd}
        >
          Trace
          {ticketFiles.traceMd && <span className="ai-tab-dot" />}
        </button>
        <button
          className={`ai-session-tab ${activeTab === "start" ? "active" : ""}`}
          onClick={() => setActiveTab("start")}
          disabled={!ticketFiles.startMd}
        >
          Start
        </button>
      </div>

      {/* Content area */}
      {activeTab === "output" ? (
        <div className="ai-session-output" ref={outputRef} onScroll={handleScroll}>
          {displayEvents.map((event, i) => (
            <AIEventLine key={i} event={event} />
          ))}
          {isRunning && <div className="job-output-cursor">_</div>}
        </div>
      ) : (
        <div className="ai-session-output ai-session-file-view">
          {fileContent ? (
            <Markdown content={fileContent} />
          ) : (
            <div className="text-muted text-center py-4">
              {isRunning ? "Waiting for Claude to create this file..." : "File not created"}
            </div>
          )}
        </div>
      )}

      {/* Jump to bottom */}
      {activeTab === "output" && !autoScroll && (
        <button className="job-output-jump-bottom" onClick={scrollToBottom} title="Jump to bottom">
          <ArrowDown className="w-4 h-4" />
          Jump to bottom
        </button>
      )}

      {/* Footer */}
      <div className="ai-session-footer">
        <div className="ai-session-stats">
          {resultEvent && (
            <>
              <span>Duration: {Math.round((resultEvent.durationMs || 0) / 1000)}s</span>
              <span>Turns: {resultEvent.numTurns}</span>
            </>
          )}
        </div>
        {isRunning && (
          <button className="btn-sm btn-danger" onClick={handleCancel}>
            <StopCircle className="w-3 h-3" />
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

function AIEventLine({ event }: { event: AIStreamEvent }) {
  switch (event.type) {
    case "status":
      return <div className="ai-event ai-event-status">{event.message}</div>;

    case "session_id":
      return (
        <div className="ai-event ai-event-status">
          Session ID: {event.sessionId}
        </div>
      );

    case "assistant_text":
      return (
        <div className="ai-event ai-event-assistant">
          <Markdown content={event.text || ""} />
        </div>
      );

    case "tool_use":
      return (
        <div className="ai-event ai-event-tool">
          <span className="ai-event-tool-name">{event.toolName}</span>
          {event.toolInput && (
            <pre className="ai-event-tool-input">{event.toolInput}</pre>
          )}
        </div>
      );

    case "result":
      return (
        <div className="ai-event ai-event-result">
          Session complete — Duration: {Math.round((event.durationMs || 0) / 1000)}s | Turns: {event.numTurns}
        </div>
      );

    case "error":
      return <div className="ai-event ai-event-error">{event.message}</div>;

    case "file_created":
      return (
        <div className="ai-event ai-event-file">
          Created: {event.filePath}
        </div>
      );

    default:
      return null;
  }
}
