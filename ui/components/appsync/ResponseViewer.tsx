import React, { useState, useMemo } from "react";
import {
  Copy,
  Check,
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Code,
  TreeDeciduous,
} from "lucide-react";
import type { GraphQLResponse } from "../../hooks/useAppSync";

interface ResponseViewerProps {
  response: GraphQLResponse | null;
  loading: boolean;
  error: string | null;
  executionTime: number | null;
}

export function ResponseViewer({ response, loading, error, executionTime }: ResponseViewerProps) {
  const [copied, setCopied] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(["root"]));
  const [showRaw, setShowRaw] = useState(false);

  const handleCopy = async () => {
    if (!response) return;
    await navigator.clipboard.writeText(JSON.stringify(response, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const togglePath = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const hasErrors = response?.errors && response.errors.length > 0;
  const hasData = response?.data !== undefined;

  if (loading) {
    return (
      <div className="appsync-response-viewer appsync-response-loading">
        <Loader2 className="w-6 h-6 animate-spin" />
        <span>Executing query...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="appsync-response-viewer appsync-response-error">
        <AlertTriangle className="w-5 h-5" />
        <div className="appsync-response-error-content">
          <span className="appsync-response-error-title">Request Error</span>
          <span className="appsync-response-error-message">{error}</span>
        </div>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="appsync-response-viewer appsync-response-empty">
        <span>Execute a query to see results</span>
      </div>
    );
  }

  return (
    <div className="appsync-response-viewer">
      <div className="appsync-response-header">
        <div className="appsync-response-status">
          {hasErrors ? (
            <span className="appsync-response-status-error">
              <AlertTriangle className="w-4 h-4" />
              {response.errors?.length} error{response.errors?.length !== 1 ? "s" : ""}
            </span>
          ) : hasData ? (
            <span className="appsync-response-status-success">
              <CheckCircle className="w-4 h-4" />
              Success
            </span>
          ) : null}
          {executionTime !== null && (
            <span className="appsync-response-time">{executionTime}ms</span>
          )}
        </div>
        <div className="appsync-response-actions">
          <button
            onClick={() => setShowRaw(!showRaw)}
            className={`btn-icon-sm ${showRaw ? "active" : ""}`}
            title={showRaw ? "Show tree view" : "Show raw JSON"}
          >
            {showRaw ? <TreeDeciduous className="w-4 h-4" /> : <Code className="w-4 h-4" />}
          </button>
          <button onClick={handleCopy} className="btn-icon-sm" title="Copy response">
            {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {hasErrors && (
        <div className="appsync-response-errors">
          {response.errors?.map((err, index) => (
            <div key={index} className="appsync-response-error-item">
              <AlertTriangle className="w-4 h-4" />
              <div className="appsync-response-error-details">
                <span className="appsync-response-error-msg">{err.message}</span>
                {err.path && (
                  <span className="appsync-response-error-path">
                    Path: {err.path.join(" > ")}
                  </span>
                )}
                {err.locations && (
                  <span className="appsync-response-error-location">
                    Line {err.locations[0]?.line}, Column {err.locations[0]?.column}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {hasData && (
        <div className="appsync-response-data">
          {showRaw ? (
            <pre className="appsync-response-raw">{JSON.stringify(response.data, null, 2)}</pre>
          ) : (
            <JsonTree
              data={response.data}
              path="root"
              expandedPaths={expandedPaths}
              onToggle={togglePath}
            />
          )}
        </div>
      )}
    </div>
  );
}

interface JsonTreeProps {
  data: any;
  path: string;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  indent?: number;
}

function JsonTree({ data, path, expandedPaths, onToggle, indent = 0 }: JsonTreeProps) {
  const isExpanded = expandedPaths.has(path);

  if (data === null) {
    return <span className="appsync-json-null">null</span>;
  }

  if (typeof data === "boolean") {
    return <span className="appsync-json-boolean">{String(data)}</span>;
  }

  if (typeof data === "number") {
    return <span className="appsync-json-number">{data}</span>;
  }

  if (typeof data === "string") {
    // Truncate long strings
    const displayValue = data.length > 100 ? data.slice(0, 100) + "..." : data;
    return <span className="appsync-json-string">"{displayValue}"</span>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <span className="appsync-json-array-empty">[]</span>;
    }

    return (
      <span className="appsync-json-array">
        <button className="appsync-json-toggle" onClick={() => onToggle(path)}>
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span className="appsync-json-bracket">[</span>
          {!isExpanded && <span className="appsync-json-preview">{data.length} items</span>}
        </button>
        {isExpanded && (
          <div className="appsync-json-children">
            {data.map((item, index) => (
              <div key={index} className="appsync-json-item">
                <span className="appsync-json-index">{index}: </span>
                <JsonTree
                  data={item}
                  path={`${path}[${index}]`}
                  expandedPaths={expandedPaths}
                  onToggle={onToggle}
                  indent={indent + 1}
                />
              </div>
            ))}
          </div>
        )}
        {isExpanded && <span className="appsync-json-bracket">]</span>}
      </span>
    );
  }

  if (typeof data === "object") {
    const keys = Object.keys(data);
    if (keys.length === 0) {
      return <span className="appsync-json-object-empty">{"{}"}</span>;
    }

    return (
      <span className="appsync-json-object">
        <button className="appsync-json-toggle" onClick={() => onToggle(path)}>
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <span className="appsync-json-bracket">{"{"}</span>
          {!isExpanded && <span className="appsync-json-preview">{keys.length} keys</span>}
        </button>
        {isExpanded && (
          <div className="appsync-json-children">
            {keys.map((key) => (
              <div key={key} className="appsync-json-item">
                <span className="appsync-json-key">{key}: </span>
                <JsonTree
                  data={data[key]}
                  path={`${path}.${key}`}
                  expandedPaths={expandedPaths}
                  onToggle={onToggle}
                  indent={indent + 1}
                />
              </div>
            ))}
          </div>
        )}
        {isExpanded && <span className="appsync-json-bracket">{"}"}</span>}
      </span>
    );
  }

  return <span>{String(data)}</span>;
}
