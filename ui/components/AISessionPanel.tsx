import React, { useEffect, useRef, useState, useCallback } from "react";
import { X, Copy, Terminal, StopCircle, Loader2, CheckCircle, XCircle, ArrowDown } from "lucide-react";
import { Markdown } from "./Markdown";

interface TranscriptBlock {
  type: "assistant" | "user";
  content?: { type: string; text?: string; name?: string; input?: string }[];
  text?: string;
}

interface AISessionPanelProps {
  jobId: string;
  ticketKey: string;
  onClose: () => void;
}

type TabName = "conversation" | "plan" | "trace" | "start";

export function AISessionPanel({ jobId, ticketKey, onClose }: AISessionPanelProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(true);
  const [jobStatus, setJobStatus] = useState<string>("running");
  const [activeTab, setActiveTab] = useState<TabName>("conversation");
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptBlock[]>([]);
  const [transcriptLines, setTranscriptLines] = useState(0);
  const [resultInfo, setResultInfo] = useState<{ durationMs?: number; numTurns?: number } | null>(null);
  const [ticketFiles, setTicketFiles] = useState<{
    startMd: string | null;
    planMd: string | null;
    traceMd: string | null;
  }>({ startMd: null, planMd: null, traceMd: null });

  const outputRef = useRef<HTMLDivElement>(null);

  // Connect to job output SSE for status events (session_id, result, completion)
  useEffect(() => {
    const eventSource = new EventSource(`/api/jobs/${jobId}/output`);

    eventSource.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);

        if (data.line) {
          try {
            const event = JSON.parse(data.line);
            if (event.type === "session_id" && event.sessionId) {
              setSessionId(event.sessionId);
            }
            if (event.type === "result") {
              setResultInfo({ durationMs: event.durationMs, numTurns: event.numTurns });
            }
          } catch {}
        }

        if (data.done) {
          setIsRunning(false);
          setJobStatus(data.status);
          eventSource.close();
        }
      } catch {}
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [jobId]);

  // Poll session transcript from JSONL file
  useEffect(() => {
    if (!sessionId) return;

    const fetchTranscript = async () => {
      try {
        const res = await fetch(`/api/ai/session-transcript/${sessionId}?after=${transcriptLines}`);
        const data = await res.json();
        if (data.messages && data.messages.length > 0) {
          setTranscript((prev) => [...prev, ...data.messages]);
        }
        if (data.totalLines > transcriptLines) {
          setTranscriptLines(data.totalLines);
        }
      } catch {}
    };

    fetchTranscript();
    const interval = setInterval(fetchTranscript, 3000);
    return () => clearInterval(interval);
  }, [sessionId, isRunning, transcriptLines]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && outputRef.current && activeTab === "conversation") {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [transcript, autoScroll, activeTab]);

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

  const isDone = !isRunning;
  const isSuccess = jobStatus === "completed";

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
          className={`ai-session-tab ${activeTab === "conversation" ? "active" : ""}`}
          onClick={() => setActiveTab("conversation")}
        >
          Conversation
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
      {activeTab === "conversation" ? (
        <div className="ai-session-output" ref={outputRef} onScroll={handleScroll}>
          {transcript.length === 0 && isRunning && (
            <div className="ai-event ai-event-status">Waiting for session to start...</div>
          )}
          {transcript.map((block, i) => (
            <TranscriptBlockView key={i} block={block} />
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
      {activeTab === "conversation" && !autoScroll && (
        <button className="job-output-jump-bottom" onClick={scrollToBottom} title="Jump to bottom">
          <ArrowDown className="w-4 h-4" />
          Jump to bottom
        </button>
      )}

      {/* Footer */}
      <div className="ai-session-footer">
        <div className="ai-session-stats">
          {resultInfo && (
            <>
              <span>Duration: {Math.round((resultInfo.durationMs || 0) / 1000)}s</span>
              <span>Turns: {resultInfo.numTurns}</span>
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

function TranscriptBlockView({ block }: { block: TranscriptBlock }) {
  if (block.type === "assistant" && block.content) {
    return (
      <>
        {block.content.map((item, i) => {
          if (item.type === "text" && item.text) {
            return (
              <div key={i} className="ai-event ai-event-assistant">
                <Markdown content={item.text} />
              </div>
            );
          }
          if (item.type === "tool_use") {
            return (
              <div key={i} className="ai-event ai-event-tool">
                <span className="ai-event-tool-name">{item.name}</span>
                {item.input && (
                  <pre className="ai-event-tool-input">{item.input}</pre>
                )}
              </div>
            );
          }
          return null;
        })}
      </>
    );
  }

  // Skip user messages (tool results) — they're noisy
  return null;
}
