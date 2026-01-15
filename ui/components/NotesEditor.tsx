import React, { useState, useEffect, useCallback, useRef } from "react";
import { FileText, Edit3, Eye, Save, Trash2, Loader2, ChevronRight, X } from "lucide-react";
import { JiraMarkdown } from "./JiraMarkdown";

interface Note {
  type: "ticket" | "pr";
  id: string;
  content: string;
  updatedAt: string;
  createdAt: string;
}

interface NotesEditorProps {
  type: "ticket" | "pr";
  id: string;
}

export function NotesEditor({ type, id }: NotesEditorProps) {
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load note on mount
  useEffect(() => {
    const loadNote = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/notes/${type}/${id}`);
        if (response.ok) {
          const data = await response.json();
          if (data.note) {
            setContent(data.note.content);
            setOriginalContent(data.note.content);
            setLastSaved(new Date(data.note.updatedAt));
          }
        }
      } catch (err) {
        console.error("Failed to load note:", err);
      } finally {
        setLoading(false);
      }
    };

    loadNote();
  }, [type, id]);

  const saveNote = useCallback(async () => {
    if (content === originalContent) return;

    setSaving(true);
    try {
      const response = await fetch(`/api/notes/${type}/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (response.ok) {
        const data = await response.json();
        setOriginalContent(content);
        setLastSaved(new Date(data.note.updatedAt));
      }
    } catch (err) {
      console.error("Failed to save note:", err);
    } finally {
      setSaving(false);
    }
  }, [type, id, content, originalContent]);

  const deleteNote = async () => {
    if (!confirm("Are you sure you want to delete this note?")) return;

    try {
      const response = await fetch(`/api/notes/${type}/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setContent("");
        setOriginalContent("");
        setLastSaved(null);
        setIsEditing(false);
      }
    } catch (err) {
      console.error("Failed to delete note:", err);
    }
  };

  // Auto-save when leaving edit mode
  const handleToggleEdit = () => {
    if (isEditing && content !== originalContent) {
      saveNote();
    }
    setIsEditing(!isEditing);
  };

  // Handle closing - save if needed
  const handleClose = () => {
    if (isEditing && content !== originalContent) {
      saveNote();
    }
    setIsEditing(false);
    setIsOpen(false);
  };

  const hasContent = content.trim().length > 0;
  const hasChanges = content !== originalContent;

  // Handle opening - go straight to edit if no content
  const handleOpen = () => {
    setIsOpen(true);
    if (!hasContent) {
      setIsEditing(true);
    }
  };

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  // Collapsed state - just show a button
  if (!isOpen) {
    return (
      <button
        className="notes-collapsed"
        onClick={handleOpen}
        disabled={loading}
      >
        <FileText className="w-4 h-4" />
        <span>Notes</span>
        {loading ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : hasContent ? (
          <span className="notes-badge">1</span>
        ) : null}
        <ChevronRight className="w-4 h-4" />
      </button>
    );
  }

  // Expanded state - full screen modal
  return (
    <>
      {/* Collapsed button still visible */}
      <button
        className="notes-collapsed"
        onClick={handleOpen}
        disabled={loading}
      >
        <FileText className="w-4 h-4" />
        <span>Notes</span>
        {hasContent && <span className="notes-badge">1</span>}
        <ChevronRight className="w-4 h-4" />
      </button>

      {/* Full screen modal */}
      <div className="notes-modal-overlay" onClick={handleClose}>
        <div className="notes-modal" onClick={(e) => e.stopPropagation()}>
          <div className="notes-modal-header">
            <div className="notes-title">
              <FileText className="w-5 h-5" />
              <span>Notes</span>
              {lastSaved && (
                <span className="notes-last-saved">
                  Last saved: {lastSaved.toLocaleString()}
                </span>
              )}
            </div>
            <div className="notes-actions">
              {hasContent && (
                <button
                  onClick={deleteNote}
                  className="btn-icon-sm"
                  title="Delete note"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              {hasChanges && (
                <button
                  onClick={saveNote}
                  disabled={saving}
                  className="btn-icon-sm"
                  title="Save"
                >
                  {saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                </button>
              )}
              <button
                onClick={handleToggleEdit}
                className={`btn-icon-sm ${isEditing ? "active" : ""}`}
                title={isEditing ? "Preview" : "Edit"}
              >
                {isEditing ? <Eye className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
              </button>
              <button
                onClick={handleClose}
                className="btn-icon-sm"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="notes-modal-body">
            {isEditing ? (
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your notes here... (Markdown supported)"
                className="notes-textarea-fullscreen"
              />
            ) : hasContent ? (
              <div className="notes-preview-fullscreen">
                <JiraMarkdown content={content} />
              </div>
            ) : (
              <div
                className="notes-empty-fullscreen"
                onClick={() => setIsEditing(true)}
              >
                <Edit3 className="w-8 h-8" />
                <span>Click to add notes...</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
