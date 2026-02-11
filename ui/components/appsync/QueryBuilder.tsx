import React, { useState, useRef, useEffect, useCallback } from "react";
import { Play, Copy, Trash2, History, AlertCircle, Check, Building2, ChevronDown, ChevronRight } from "lucide-react";
import { FieldSelector } from "./FieldSelector";
import { VariablesFieldSelector } from "./VariablesFieldSelector";
import type { SchemaField, ParsedSchema } from "../../hooks/useAppSync";

interface QueryBuilderProps {
  query: string;
  variables: string;
  onQueryChange: (query: string) => void;
  onVariablesChange: (variables: string) => void;
  onExecute: () => void;
  isExecuting: boolean;
  selectedField: { field: SchemaField; category: "query" | "mutation" | "subscription" } | null;
  schema: ParsedSchema | null;
}

const STORAGE_KEY_HISTORY = "appsync_query_history";
const STORAGE_KEY_ORG_ID = "appsync_global_org_id";
const MAX_HISTORY_ITEMS = 20;

// GraphQL syntax highlighting
function highlightGraphQL(code: string): string {
  if (!code) return "";

  // Escape HTML
  let html = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Comments
  html = html.replace(/(#.*$)/gm, '<span class="gql-comment">$1</span>');

  // Strings
  html = html.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="gql-string">$1</span>');

  // Keywords
  html = html.replace(
    /\b(query|mutation|subscription|fragment|on|type|input|enum|scalar|interface|union|extend|implements|directive)\b/g,
    '<span class="gql-keyword">$1</span>'
  );

  // Built-in types
  html = html.replace(
    /\b(String|Int|Float|Boolean|ID)\b/g,
    '<span class="gql-type">$1</span>'
  );

  // Variables
  html = html.replace(/(\$\w+)/g, '<span class="gql-variable">$1</span>');

  // Directives
  html = html.replace(/(@\w+)/g, '<span class="gql-directive">$1</span>');

  // Field arguments and object keys (word followed by colon)
  html = html.replace(/(\w+)(?=\s*:)/g, '<span class="gql-field">$1</span>');

  // Punctuation
  html = html.replace(/([{}()\[\]:!])/g, '<span class="gql-punctuation">$1</span>');

  return html;
}

interface HistoryItem {
  query: string;
  variables: string;
  timestamp: number;
  name?: string;
}

export function QueryBuilder({
  query,
  variables,
  onQueryChange,
  onVariablesChange,
  onExecute,
  isExecuting,
  selectedField,
  schema,
}: QueryBuilderProps) {
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [variablesError, setVariablesError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set());
  const [globalOrgId, setGlobalOrgId] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_ORG_ID) || "";
    } catch {
      return "";
    }
  });
  const [showOrgIdInput, setShowOrgIdInput] = useState(false);
  const [queryExpanded, setQueryExpanded] = useState(true);
  const [varsExpanded, setVarsExpanded] = useState(true);
  const [inputFieldsExpanded, setInputFieldsExpanded] = useState(true);
  const [returnFieldsExpanded, setReturnFieldsExpanded] = useState(true);
  const queryRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);

  // Sync scroll between textarea and highlight overlay
  const handleScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = e.currentTarget.scrollTop;
      highlightRef.current.scrollLeft = e.currentTarget.scrollLeft;
    }
  };

  // Save global org ID
  const handleOrgIdChange = (newOrgId: string) => {
    setGlobalOrgId(newOrgId);
    try {
      localStorage.setItem(STORAGE_KEY_ORG_ID, newOrgId);
    } catch {
      // Ignore errors
    }
  };

  // Load history from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_HISTORY);
      if (stored) {
        setHistory(JSON.parse(stored));
      }
    } catch {
      // Ignore errors
    }
  }, []);

  // Generate query template when field is selected
  useEffect(() => {
    if (selectedField) {
      const { field, category } = selectedField;
      setSelectedFields(new Set()); // Clear fields on new selection
      const generatedQuery = generateQueryTemplate(field, category, new Set());
      onQueryChange(generatedQuery);

      // Generate variables template
      if (field.args && field.args.length > 0) {
        const varsTemplate = generateVariablesTemplate(field);
        onVariablesChange(varsTemplate);
      }

      // Focus query editor
      queryRef.current?.focus();
    }
  }, [selectedField]);

  // Validate variables JSON
  useEffect(() => {
    if (!variables.trim()) {
      setVariablesError(null);
      return;
    }
    try {
      JSON.parse(variables);
      setVariablesError(null);
    } catch (e: any) {
      setVariablesError(e.message);
    }
  }, [variables]);

  const generateFieldsString = (fields: Set<string>, indent: string = "    "): string => {
    // Always include __typename
    const allFields = new Set(fields);
    allFields.add("__typename");

    // Build a tree from field paths
    const tree: Record<string, any> = {};
    for (const path of allFields) {
      const parts = path.split(".");
      let current = tree;
      for (const part of parts) {
        if (!current[part]) {
          current[part] = {};
        }
        current = current[part];
      }
    }

    // Render tree to string
    const renderTree = (node: Record<string, any>, depth: number): string => {
      const lines: string[] = [];
      const currentIndent = indent + "  ".repeat(depth);

      for (const [key, children] of Object.entries(node)) {
        const childKeys = Object.keys(children);
        if (childKeys.length === 0) {
          lines.push(`${currentIndent}${key}`);
        } else {
          lines.push(`${currentIndent}${key} {`);
          lines.push(renderTree(children, depth + 1));
          lines.push(`${currentIndent}}`);
        }
      }

      return lines.join("\n");
    };

    return renderTree(tree, 0);
  };

  const generateQueryTemplate = (
    field: SchemaField,
    category: "query" | "mutation" | "subscription",
    fields: Set<string>
  ): string => {
    // arg.type now includes the full type with ! markers (e.g., "[ID!]!")
    const args = field.args
      ?.map((arg) => `$${arg.name}: ${arg.type}`)
      .join(", ");

    const argsUsage = field.args?.map((arg) => `${arg.name}: $${arg.name}`).join(", ");

    const operationType = category;
    const operationName = field.name.charAt(0).toUpperCase() + field.name.slice(1);

    let template = `${operationType} ${operationName}`;
    if (args) {
      template += `(${args})`;
    }
    template += ` {\n  ${field.name}`;
    if (argsUsage) {
      template += `(${argsUsage})`;
    }

    const fieldsStr = generateFieldsString(fields);
    template += ` {\n${fieldsStr}\n  }\n}`;

    return template;
  };

  // Helper to get default value for a type, with field name context for better defaults
  // Always returns a value - fills all fields with sensible defaults
  const getDefaultForType = (typeName: string, fieldName?: string): any => {
    // Strip non-null markers for type lookup
    const baseType = typeName.replace(/[!\[\]]/g, "").trim();
    const isList = typeName.includes("[");
    const name = fieldName?.toLowerCase() || "";

    // Handle special field names first
    if (name === "organizationid" || name === "organization_id" || name === "org_id") {
      return globalOrgId || "YOUR_ORG_ID";
    }
    if (name === "page_size" || name === "pagesize" || name === "limit" || name === "take") {
      return 25;
    }
    if (name === "offset" || name === "skip") {
      return 0;
    }
    if (name === "direction") {
      return "ASC";
    }
    if (name === "field" || name === "sortfield" || name === "sort_field") {
      return "updated";
    }
    if (name === "query" || name === "querystring" || name === "search" || name === "searchtext") {
      return "*";
    }
    if (name === "fields") {
      return "*";
    }
    if (name === "excludes" || name === "exclude") {
      return "";
    }
    if (name === "includes" || name === "include") {
      return "*";
    }
    if (name === "returnhidden" || name === "return_hidden" || name === "includehidden") {
      return true;
    }

    // Check if it's a known input type in the schema
    const inputType = schema?.types.find(
      (t) => t.name === baseType && t.kind === "INPUT_OBJECT"
    );

    if (inputType && inputType.inputFields) {
      // Generate object with defaults for ALL input type fields
      const obj: Record<string, any> = {};
      for (const field of inputType.inputFields) {
        obj[field.name] = getDefaultForType(field.type, field.name);
      }
      return isList ? [obj] : obj;
    }

    // Handle scalar types with field name context
    if (baseType === "Int") {
      if (name.includes("page") || name.includes("size") || name.includes("limit") || name.includes("take")) {
        return isList ? [25] : 25;
      }
      return isList ? [1] : 1;
    }
    if (baseType === "Float") {
      return isList ? [0.0] : 0.0;
    }
    if (baseType === "Boolean") {
      return isList ? [true] : true;
    }
    if (baseType === "ID") {
      // Use global org ID for organization-related fields
      if (name.includes("organization") || name.includes("org")) {
        return isList ? [globalOrgId || "YOUR_ORG_ID"] : (globalOrgId || "YOUR_ORG_ID");
      }
      return isList ? ["1"] : "1";
    }
    if (baseType === "String") {
      // Context-aware string defaults
      if (name.includes("email")) return isList ? ["user@example.com"] : "user@example.com";
      if (name.includes("phone")) return isList ? ["+1234567890"] : "+1234567890";
      if (name.includes("name")) return isList ? ["Example"] : "Example";
      if (name.includes("direction") || name.includes("order")) return isList ? ["ASC"] : "ASC";
      if (name.includes("status")) return isList ? ["active"] : "active";
      if (name.includes("type")) return isList ? ["default"] : "default";
      // Default string - provide example value
      return isList ? ["1"] : "";
    }
    if (baseType.startsWith("AWS")) {
      // AWS scalar types
      if (baseType === "AWSDateTime") {
        const val = new Date().toISOString();
        return isList ? [val] : val;
      }
      if (baseType === "AWSDate") {
        const val = new Date().toISOString().split("T")[0];
        return isList ? [val] : val;
      }
      if (baseType === "AWSEmail") {
        return isList ? ["user@example.com"] : "user@example.com";
      }
      if (baseType === "AWSPhone") {
        return isList ? ["+1234567890"] : "+1234567890";
      }
      if (baseType === "AWSURL") {
        return isList ? ["https://example.com"] : "https://example.com";
      }
      return isList ? [""] : "";
    }

    // Enum type - try to get first value
    const enumType = schema?.types.find(
      (t) => t.name === baseType && t.kind === "ENUM"
    );
    if (enumType && enumType.enumValues && enumType.enumValues.length > 0) {
      const firstVal = enumType.enumValues[0];
      return isList ? [firstVal] : firstVal;
    }

    // Unknown type - return empty object/array with example
    return isList ? [{}] : {};
  };

  // Fields to omit from generated variables
  const OMIT_FIELDS = ["querystring", "query_string"];

  const generateVariablesTemplate = (field: SchemaField): string => {
    const vars: Record<string, any> = {};
    field.args?.forEach((arg) => {
      // Skip fields we want to omit
      if (OMIT_FIELDS.includes(arg.name.toLowerCase())) {
        return;
      }
      vars[arg.name] = getDefaultForType(arg.type, arg.name);
    });
    return JSON.stringify(vars, null, 2);
  };

  const handleToggleField = useCallback((fieldPath: string, include: boolean) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (include) {
        next.add(fieldPath);
      } else {
        next.delete(fieldPath);
      }

      // Update query with new fields
      if (selectedField) {
        const newQuery = generateQueryTemplate(selectedField.field, selectedField.category, next);
        onQueryChange(newQuery);
      }

      return next;
    });
  }, [selectedField, onQueryChange]);

  const handleSelectAll = useCallback((fields: string[]) => {
    const newFields = new Set(fields);
    setSelectedFields(newFields);

    if (selectedField) {
      const newQuery = generateQueryTemplate(selectedField.field, selectedField.category, newFields);
      onQueryChange(newQuery);
    }
  }, [selectedField, onQueryChange]);

  const handleClearFields = useCallback(() => {
    setSelectedFields(new Set());

    if (selectedField) {
      const newQuery = generateQueryTemplate(selectedField.field, selectedField.category, new Set());
      onQueryChange(newQuery);
    }
  }, [selectedField, onQueryChange]);

  const handleExecute = () => {
    // Save to history before executing
    if (query.trim()) {
      const newItem: HistoryItem = {
        query,
        variables,
        timestamp: Date.now(),
        name: extractOperationName(query),
      };

      const newHistory = [newItem, ...history.filter((h) => h.query !== query)].slice(
        0,
        MAX_HISTORY_ITEMS
      );

      setHistory(newHistory);
      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(newHistory));
    }

    onExecute();
  };

  const extractOperationName = (q: string): string | undefined => {
    const match = q.match(/(?:query|mutation|subscription)\s+(\w+)/);
    return match?.[1];
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(query);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    onQueryChange("");
    onVariablesChange("");
    setSelectedFields(new Set());
  };

  const handleHistorySelect = (item: HistoryItem) => {
    onQueryChange(item.query);
    onVariablesChange(item.variables);
    setShowHistory(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Ctrl/Cmd + Enter to execute
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!isExecuting && !variablesError) {
        handleExecute();
      }
    }
  };

  return (
    <div className="appsync-query-builder">
      <div className="appsync-query-toolbar">
        <button
          onClick={handleExecute}
          disabled={isExecuting || !query.trim() || !!variablesError}
          className="btn-primary"
          title="Execute (Ctrl+Enter)"
        >
          <Play className="w-4 h-4" />
          Execute
        </button>
        <button onClick={handleCopy} className="btn-icon-sm" title="Copy query">
          {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
        </button>
        <button onClick={handleClear} className="btn-icon-sm" title="Clear">
          <Trash2 className="w-4 h-4" />
        </button>
        <div className="appsync-toolbar-spacer" />
        <div className="appsync-org-id-wrapper">
          {showOrgIdInput ? (
            <input
              type="text"
              className="appsync-org-id-input"
              value={globalOrgId}
              onChange={(e) => handleOrgIdChange(e.target.value)}
              onBlur={() => setShowOrgIdInput(false)}
              onKeyDown={(e) => e.key === "Enter" && setShowOrgIdInput(false)}
              placeholder="Organization ID"
              autoFocus
            />
          ) : (
            <button
              onClick={() => setShowOrgIdInput(true)}
              className={`btn-icon-sm appsync-org-id-btn ${globalOrgId ? "has-value" : ""}`}
              title={globalOrgId ? `Org ID: ${globalOrgId}` : "Set global Organization ID"}
            >
              <Building2 className="w-4 h-4" />
              {globalOrgId && <span className="appsync-org-id-badge">{globalOrgId.slice(0, 8)}{globalOrgId.length > 8 ? "…" : ""}</span>}
            </button>
          )}
        </div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className={`btn-icon-sm ${showHistory ? "active" : ""}`}
          title="Query history"
        >
          <History className="w-4 h-4" />
        </button>
      </div>

      {showHistory && history.length > 0 && (
        <div className="appsync-history-panel">
          <div className="appsync-history-header">Recent Queries</div>
          <div className="appsync-history-list">
            {history.map((item, index) => (
              <button
                key={index}
                className="appsync-history-item"
                onClick={() => handleHistorySelect(item)}
              >
                <span className="appsync-history-name">
                  {item.name || "Unnamed query"}
                </span>
                <span className="appsync-history-time">
                  {new Date(item.timestamp).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="appsync-query-content">
        <div className="appsync-query-editors">
          <div className={`appsync-editor-section ${!queryExpanded ? "collapsed" : ""}`}>
            <button className="appsync-editor-label" onClick={() => setQueryExpanded(!queryExpanded)}>
              {queryExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Query
            </button>
            {queryExpanded && (
              <div className="appsync-editor-wrapper">
                <pre
                  ref={highlightRef}
                  className="appsync-query-highlight"
                  aria-hidden="true"
                  dangerouslySetInnerHTML={{ __html: highlightGraphQL(query) + "\n" }}
                />
                <textarea
                  ref={queryRef}
                  className="appsync-query-textarea"
                  value={query}
                  onChange={(e) => onQueryChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onScroll={handleScroll}
                  placeholder="Enter your GraphQL query here..."
                  spellCheck={false}
                />
              </div>
            )}
          </div>

          <div className={`appsync-editor-section appsync-variables-section ${!varsExpanded ? "collapsed" : ""}`}>
            <button className="appsync-editor-label" onClick={() => setVarsExpanded(!varsExpanded)}>
              {varsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Variables (JSON)
              {variablesError && (
                <span className="appsync-variables-error">
                  <AlertCircle className="w-3 h-3" />
                  {variablesError}
                </span>
              )}
            </button>
            {varsExpanded && (
              <textarea
                className={`appsync-variables-textarea ${variablesError ? "error" : ""}`}
                value={variables}
                onChange={(e) => onVariablesChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="{}"
                spellCheck={false}
              />
            )}
          </div>
        </div>

        <div className="appsync-field-selectors">
          <div className={`appsync-field-selector-panel ${!returnFieldsExpanded ? "collapsed" : ""}`}>
            <button className="appsync-collapse-header" onClick={() => setReturnFieldsExpanded(!returnFieldsExpanded)}>
              {returnFieldsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Return Fields
            </button>
            {returnFieldsExpanded && (
              <FieldSelector
                schema={schema}
                returnType={selectedField?.field.type || null}
                selectedFields={selectedFields}
                onToggleField={handleToggleField}
                onSelectAll={handleSelectAll}
                onClear={handleClearFields}
              />
            )}
          </div>
          <div className={`appsync-field-selector-panel ${!inputFieldsExpanded ? "collapsed" : ""}`}>
            <button className="appsync-collapse-header" onClick={() => setInputFieldsExpanded(!inputFieldsExpanded)}>
              {inputFieldsExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              Input Fields
            </button>
            {inputFieldsExpanded && (
              <VariablesFieldSelector
                schema={schema}
                selectedField={selectedField}
                variables={variables}
                onVariablesChange={onVariablesChange}
                globalOrgId={globalOrgId}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
