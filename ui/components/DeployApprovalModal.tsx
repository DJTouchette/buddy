import React, { useEffect, useState, useMemo } from "react";
import {
  X,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Plus,
  Minus,
  RefreshCw,
  Search,
  FileText,
  Shield,
  Loader2,
} from "lucide-react";

interface DeployApprovalModalProps {
  jobId: string;
  target: string;
  diffOutput: string[];
  onApprove: () => void;
  onReject: () => void;
  isResponding: boolean;
}

interface Detection {
  type: "danger" | "warning" | "info";
  message: string;
  lines: string[];
}

interface ChangeSummary {
  additions: number;
  modifications: number;
  deletions: number;
  replacements: number;
}

export function DeployApprovalModal({
  jobId,
  target,
  diffOutput,
  onApprove,
  onReject,
  isResponding,
}: DeployApprovalModalProps) {
  const [activeTab, setActiveTab] = useState<"summary" | "full">("summary");
  const [searchQuery, setSearchQuery] = useState("");

  // Parse diff output to extract summary and detections
  const { summary, detections, filteredOutput } = useMemo(() => {
    const summary: ChangeSummary = {
      additions: 0,
      modifications: 0,
      deletions: 0,
      replacements: 0,
    };
    const detections: Detection[] = [];
    const seenDetections = new Set<string>();

    // Lines that indicate dangerous changes
    const dangerPatterns = [
      { pattern: /staticbackend/i, message: "Static Backend changes detected" },
      { pattern: /aurora.*proxy/i, message: "Aurora Proxy changes detected" },
      { pattern: /rds|database|aurora/i, message: "Database resource changes" },
      { pattern: /secretsmanager|secret/i, message: "Secrets Manager changes" },
      { pattern: /iam.*policy|policy.*iam/i, message: "IAM Policy changes" },
      { pattern: /security.*group/i, message: "Security Group changes" },
      { pattern: /vpc|subnet|route.*table/i, message: "VPC/Network changes" },
    ];

    // Warning patterns
    const warningPatterns = [
      { pattern: /lambda.*function/i, message: "Lambda function changes" },
      { pattern: /api.*gateway/i, message: "API Gateway changes" },
      { pattern: /cognito/i, message: "Cognito changes" },
      { pattern: /s3.*bucket/i, message: "S3 Bucket changes" },
      { pattern: /dynamodb/i, message: "DynamoDB changes" },
      { pattern: /cloudfront/i, message: "CloudFront changes" },
    ];

    for (const line of diffOutput) {
      // Count changes by type
      if (line.match(/^\s*\[\+\]/) || line.match(/^\s*\+\s+/)) {
        summary.additions++;
      } else if (line.match(/^\s*\[-\]/) || line.match(/^\s*-\s+/) || line.includes("destroy")) {
        summary.deletions++;
      } else if (line.match(/^\s*\[~\]/) || line.match(/^\s*~\s+/)) {
        summary.modifications++;
        // Check for replacement
        if (line.toLowerCase().includes("replace")) {
          summary.replacements++;
        }
      }

      // Check for danger patterns
      for (const { pattern, message } of dangerPatterns) {
        if (pattern.test(line) && !seenDetections.has(message)) {
          seenDetections.add(message);
          detections.push({
            type: "danger",
            message,
            lines: [line],
          });
        }
      }

      // Check for warning patterns
      for (const { pattern, message } of warningPatterns) {
        if (pattern.test(line) && !seenDetections.has(message)) {
          seenDetections.add(message);
          detections.push({
            type: "warning",
            message,
            lines: [line],
          });
        }
      }

      // Detect resource deletions
      if ((line.includes("[-]") || line.includes("destroy")) && !seenDetections.has("resource-deletion")) {
        seenDetections.add("resource-deletion");
        detections.push({
          type: "danger",
          message: "Resources will be DELETED",
          lines: diffOutput.filter(l => l.includes("[-]") || l.toLowerCase().includes("destroy")),
        });
      }

      // Detect replacements
      if (line.toLowerCase().includes("replace") && !seenDetections.has("resource-replacement")) {
        seenDetections.add("resource-replacement");
        detections.push({
          type: "danger",
          message: "Resources will be REPLACED (destroy + recreate)",
          lines: diffOutput.filter(l => l.toLowerCase().includes("replace")),
        });
      }
    }

    // Add info for creations
    if (summary.additions > 0) {
      detections.push({
        type: "info",
        message: `${summary.additions} resource(s) will be created`,
        lines: diffOutput.filter(l => l.match(/^\s*\[\+\]/) || (l.match(/^\s*\+\s+/) && !l.startsWith("+"))),
      });
    }

    // Sort detections: danger first, then warning, then info
    detections.sort((a, b) => {
      const order = { danger: 0, warning: 1, info: 2 };
      return order[a.type] - order[b.type];
    });

    // Filter output for search
    const filtered = searchQuery
      ? diffOutput.filter(line => line.toLowerCase().includes(searchQuery.toLowerCase()))
      : diffOutput;

    return { summary, detections, filteredOutput: filtered };
  }, [diffOutput, searchQuery]);

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isResponding) {
        onReject();
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onReject, isResponding]);

  const hasDangerousChanges = detections.some(d => d.type === "danger");
  const hasAnyChanges = summary.additions > 0 || summary.modifications > 0 || summary.deletions > 0;

  return (
    <div className="modal-overlay deploy-approval-overlay">
      <div className="modal-content deploy-approval-modal">
        {/* Header */}
        <div className="modal-header deploy-approval-header">
          <div className="deploy-approval-title">
            <Shield className="w-5 h-5" />
            <div>
              <h2>Deploy Approval Required</h2>
              <p className="text-muted">{target}</p>
            </div>
          </div>
          <button
            className="btn-icon"
            onClick={onReject}
            disabled={isResponding}
            title="Cancel deploy"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Summary Banner */}
        <div className={`deploy-approval-banner ${hasDangerousChanges ? "danger" : hasAnyChanges ? "warning" : "info"}`}>
          <div className="deploy-approval-summary">
            <div className="deploy-approval-stat">
              <Plus className="w-4 h-4 text-green-500" />
              <span>{summary.additions} additions</span>
            </div>
            <div className="deploy-approval-stat">
              <RefreshCw className="w-4 h-4 text-yellow-500" />
              <span>{summary.modifications} modifications</span>
            </div>
            <div className="deploy-approval-stat">
              <Minus className="w-4 h-4 text-red-500" />
              <span>{summary.deletions} deletions</span>
            </div>
            {summary.replacements > 0 && (
              <div className="deploy-approval-stat danger">
                <AlertTriangle className="w-4 h-4" />
                <span>{summary.replacements} replacements</span>
              </div>
            )}
          </div>
          {hasDangerousChanges && (
            <div className="deploy-approval-warning">
              <AlertTriangle className="w-4 h-4" />
              <span>This deployment contains potentially dangerous changes. Please review carefully.</span>
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="deploy-approval-tabs">
          <button
            className={`deploy-approval-tab ${activeTab === "summary" ? "active" : ""}`}
            onClick={() => setActiveTab("summary")}
          >
            <AlertTriangle className="w-4 h-4" />
            Summary ({detections.length})
          </button>
          <button
            className={`deploy-approval-tab ${activeTab === "full" ? "active" : ""}`}
            onClick={() => setActiveTab("full")}
          >
            <FileText className="w-4 h-4" />
            Full Output ({diffOutput.length} lines)
          </button>
        </div>

        {/* Tab Content */}
        <div className="deploy-approval-content">
          {activeTab === "summary" ? (
            <div className="deploy-approval-detections">
              {detections.length === 0 ? (
                <div className="deploy-approval-no-detections">
                  <CheckCircle className="w-8 h-8 text-green-500" />
                  <p>No significant changes detected</p>
                  <p className="text-muted text-sm">This appears to be a safe deployment</p>
                </div>
              ) : (
                detections.map((detection, i) => (
                  <div key={i} className={`deploy-approval-detection ${detection.type}`}>
                    <div className="deploy-approval-detection-header">
                      {detection.type === "danger" ? (
                        <XCircle className="w-5 h-5" />
                      ) : detection.type === "warning" ? (
                        <AlertTriangle className="w-5 h-5" />
                      ) : (
                        <CheckCircle className="w-5 h-5" />
                      )}
                      <span className="deploy-approval-detection-message">{detection.message}</span>
                    </div>
                    {detection.lines.length > 0 && detection.lines.length <= 5 && (
                      <div className="deploy-approval-detection-lines">
                        {detection.lines.map((line, j) => (
                          <code key={j}>{line}</code>
                        ))}
                      </div>
                    )}
                    {detection.lines.length > 5 && (
                      <div className="deploy-approval-detection-lines">
                        {detection.lines.slice(0, 3).map((line, j) => (
                          <code key={j}>{line}</code>
                        ))}
                        <code className="text-muted">... and {detection.lines.length - 3} more</code>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="deploy-approval-full-output">
              <div className="deploy-approval-search">
                <Search className="w-4 h-4" />
                <input
                  type="text"
                  placeholder="Search output..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
                {searchQuery && (
                  <span className="deploy-approval-search-count">
                    {filteredOutput.length} / {diffOutput.length}
                  </span>
                )}
              </div>
              <div className="deploy-approval-output-lines">
                {filteredOutput.map((line, i) => (
                  <DiffLine key={i} line={line} searchQuery={searchQuery} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="modal-actions deploy-approval-actions">
          <button
            className="btn-secondary"
            onClick={onReject}
            disabled={isResponding}
          >
            <XCircle className="w-4 h-4" />
            Reject
          </button>
          <button
            className={`btn-primary ${hasDangerousChanges ? "btn-danger" : ""}`}
            onClick={onApprove}
            disabled={isResponding}
          >
            {isResponding ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <CheckCircle className="w-4 h-4" />
                {hasDangerousChanges ? "Approve Anyway" : "Approve Deploy"}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Render a single diff line with syntax highlighting
 */
function DiffLine({ line, searchQuery }: { line: string; searchQuery: string }) {
  let className = "diff-line";

  // Determine line type
  if (line.match(/^\s*\[\+\]/) || line.match(/^\s*\+\s+/)) {
    className += " diff-add";
  } else if (line.match(/^\s*\[-\]/) || line.match(/^\s*-\s+/)) {
    className += " diff-remove";
  } else if (line.match(/^\s*\[~\]/) || line.match(/^\s*~\s+/)) {
    className += " diff-modify";
  } else if (line.includes("Stack ") || line.includes("Resources")) {
    className += " diff-header";
  }

  // Highlight dangerous keywords
  if (/staticbackend|aurora.*proxy|destroy|replace/i.test(line)) {
    className += " diff-danger";
  }

  // Highlight search matches
  if (searchQuery) {
    const regex = new RegExp(`(${escapeRegex(searchQuery)})`, "gi");
    const parts = line.split(regex);

    return (
      <div className={className}>
        {parts.map((part, i) =>
          regex.test(part) ? (
            <mark key={i} className="search-highlight">{part}</mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </div>
    );
  }

  return <div className={className}>{line}</div>;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
