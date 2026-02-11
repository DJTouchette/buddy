import React, { useState, useEffect, useCallback } from "react";
import {
  FileText,
  FolderOpen,
  FolderClosed,
  Edit3,
  Eye,
  Save,
  ChevronRight,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { Markdown } from "../components/Markdown";

interface TreeEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeEntry[];
}

function TreeNode({
  entry,
  selectedPath,
  onSelect,
  depth = 0,
}: {
  entry: TreeEntry;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(true);

  if (entry.type === "directory") {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="tree-item"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 shrink-0" />
          )}
          {expanded ? (
            <FolderOpen className="w-4 h-4 shrink-0 text-yellow-500" />
          ) : (
            <FolderClosed className="w-4 h-4 shrink-0 text-yellow-500" />
          )}
          <span className="truncate">{entry.name}</span>
        </button>
        {expanded && entry.children && (
          <div>
            {entry.children.map((child) => (
              <TreeNode
                key={child.path}
                entry={child}
                selectedPath={selectedPath}
                onSelect={onSelect}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = selectedPath === entry.path;
  return (
    <button
      onClick={() => onSelect(entry.path)}
      className={`tree-item ${isSelected ? "tree-item-active" : ""}`}
      style={{ paddingLeft: `${depth * 16 + 28}px` }}
    >
      <FileText className="w-4 h-4 shrink-0" />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

export function DocsPage() {
  const [tree, setTree] = useState<TreeEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);

  useEffect(() => {
    fetch("/api/docs/tree")
      .then((r) => r.json())
      .then((data) => setTree(data.tree))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const loadFile = useCallback(async (path: string) => {
    setFileLoading(true);
    setEditing(false);
    setSelectedPath(path);
    try {
      const res = await fetch(`/api/docs/file?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      setContent(data.content);
      setEditContent(data.content);
    } catch (err) {
      console.error("Failed to load file:", err);
    } finally {
      setFileLoading(false);
    }
  }, []);

  const saveFile = useCallback(async () => {
    if (!selectedPath) return;
    setSaving(true);
    try {
      await fetch("/api/docs/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: selectedPath, content: editContent }),
      });
      setContent(editContent);
      setEditing(false);
    } catch (err) {
      console.error("Failed to save file:", err);
    } finally {
      setSaving(false);
    }
  }, [selectedPath, editContent]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex gap-4" style={{ height: "calc(100vh - 120px)" }}>
      {/* Sidebar */}
      <div
        className="card flex flex-col shrink-0"
        style={{ width: "260px", overflow: "hidden" }}
      >
        <div className="p-3 border-b font-medium text-sm">Agent Docs</div>
        <div className="overflow-y-auto flex-1">{tree.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            selectedPath={selectedPath}
            onSelect={loadFile}
          />
        ))}</div>
      </div>

      {/* Right column: top bar + content */}
      <div className="flex-1 flex flex-col gap-2 overflow-hidden">
        {selectedPath && (
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm truncate">
              {selectedPath}
            </span>
            <div className="flex items-center gap-2">
              {editing ? (
                <>
                  <button
                    onClick={() => {
                      setEditing(false);
                      setEditContent(content);
                    }}
                    className="btn btn-sm btn-secondary"
                  >
                    <Eye className="w-4 h-4" />
                    Preview
                  </button>
                  <button
                    onClick={saveFile}
                    disabled={saving}
                    className="btn btn-sm btn-primary"
                  >
                    {saving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    Save
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setEditing(true)}
                  className="btn btn-sm btn-secondary"
                >
                  <Edit3 className="w-4 h-4" />
                  Edit
                </button>
              )}
            </div>
          </div>
        )}

        <div className="card flex-1 flex flex-col overflow-hidden docs-panel">
          {selectedPath ? (
            <div className="flex-1 overflow-y-auto p-4 flex flex-col">
              {fileLoading ? (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              ) : editing ? (
                <div className="flex-1 flex flex-col">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="docs-editor"
                    spellCheck={false}
                  />
                </div>
              ) : (
                <Markdown content={content} />
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-secondary">
              Select a file from the sidebar to view
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
