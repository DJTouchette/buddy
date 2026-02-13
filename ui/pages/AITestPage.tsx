import React, { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { AISessionPanel } from "../components/AISessionPanel";

interface AITestPageProps {
  navigate: (path: string) => void;
}

export function AITestPage({ navigate }: AITestPageProps) {
  const [ticketKey, setTicketKey] = useState("TEST-1");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiSessionJobId, setAiSessionJobId] = useState<string | null>(null);
  const [activeTicketKey, setActiveTicketKey] = useState<string>("");

  const handleStart = async () => {
    if (!ticketKey.trim()) return;

    setStarting(true);
    setError(null);

    try {
      const response = await fetch("/api/ai/start-ticket-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketKey: ticketKey.trim(),
          summary: summary.trim() || ticketKey.trim(),
          description: description.trim(),
        }),
      });

      const data = await response.json();

      if (response.ok && data.jobId) {
        setActiveTicketKey(ticketKey.trim());
        setAiSessionJobId(data.jobId);
      } else {
        setError(data.error || "Failed to start AI session");
      }
    } catch (err) {
      setError(`Failed to start: ${err}`);
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="detail-page">
      <div className="detail-page-header">
        <div className="detail-page-title">
          <h1>AI Test</h1>
        </div>
      </div>

      <div className="ticket-detail">
        <div className="detail-section">
          <h4 className="detail-section-title">
            <Sparkles className="w-4 h-4" /> Start with AI (Test Mode)
          </h4>
          <p className="text-muted" style={{ fontSize: "0.85rem", marginBottom: "1rem" }}>
            Test the AI session flow without JIRA. Enter a ticket key and description manually.
            Make sure you have a repo selected on the Git page.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div>
              <label className="detail-label" style={{ marginBottom: "0.25rem", display: "block" }}>
                Ticket Key
              </label>
              <input
                type="text"
                value={ticketKey}
                onChange={(e) => setTicketKey(e.target.value.toUpperCase())}
                placeholder="e.g. PROJ-123"
                className="input"
                style={{ width: "200px" }}
                disabled={!!aiSessionJobId}
              />
            </div>

            <div>
              <label className="detail-label" style={{ marginBottom: "0.25rem", display: "block" }}>
                Summary
              </label>
              <input
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Brief summary of the ticket"
                className="input"
                style={{ width: "100%" }}
                disabled={!!aiSessionJobId}
              />
            </div>

            <div>
              <label className="detail-label" style={{ marginBottom: "0.25rem", display: "block" }}>
                Description (markdown)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what needs to be done..."
                className="input"
                rows={6}
                style={{ width: "100%", fontFamily: "monospace", fontSize: "0.85rem", resize: "vertical" }}
                disabled={!!aiSessionJobId}
              />
            </div>

            {error && (
              <div className="checkout-result error">
                {error}
              </div>
            )}

            {!aiSessionJobId && (
              <div>
                <button
                  className="btn-secondary btn-ai"
                  onClick={handleStart}
                  disabled={starting || !ticketKey.trim()}
                >
                  {starting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  Start with AI
                </button>
              </div>
            )}
          </div>
        </div>

        {aiSessionJobId && (
          <AISessionPanel
            jobId={aiSessionJobId}
            ticketKey={activeTicketKey}
            onClose={() => setAiSessionJobId(null)}
          />
        )}
      </div>
    </div>
  );
}
