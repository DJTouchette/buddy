import React, { useEffect, useCallback } from "react";
import { X, Download, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import type { JiraAttachment } from "../../services/jiraService";

interface AttachmentPreviewProps {
  attachment: JiraAttachment | null;
  attachments?: JiraAttachment[];
  onClose: () => void;
  onNavigate?: (attachment: JiraAttachment) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentPreview({ attachment, attachments, onClose, onNavigate }: AttachmentPreviewProps) {
  const contentUrl = attachment ? `/api/jira/attachment/${attachment.id}` : "";

  const isImage = attachment?.mimeType.startsWith("image/");
  const isVideo = attachment?.mimeType.startsWith("video/");
  const isPDF = attachment?.mimeType === "application/pdf";
  const isPreviewable = isImage || isVideo || isPDF;

  // Find current index for navigation
  const currentIndex = attachments?.findIndex(a => a.id === attachment?.id) ?? -1;
  const hasPrev = currentIndex > 0;
  const hasNext = attachments && currentIndex < attachments.length - 1;

  const handlePrev = useCallback(() => {
    if (hasPrev && attachments && onNavigate) {
      onNavigate(attachments[currentIndex - 1]);
    }
  }, [hasPrev, attachments, currentIndex, onNavigate]);

  const handleNext = useCallback(() => {
    if (hasNext && attachments && onNavigate) {
      onNavigate(attachments[currentIndex + 1]);
    }
  }, [hasNext, attachments, currentIndex, onNavigate]);

  // Keyboard navigation
  useEffect(() => {
    if (!attachment) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      } else if (e.key === "ArrowRight") {
        handleNext();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [attachment, onClose, handlePrev, handleNext]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (attachment) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [attachment]);

  if (!attachment) return null;

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = contentUrl;
    link.download = attachment.filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="attachment-preview-overlay" onClick={handleBackdropClick}>
      {/* Navigation arrows */}
      {hasPrev && (
        <button className="attachment-preview-nav prev" onClick={handlePrev} title="Previous (Left Arrow)">
          <ChevronLeft className="w-8 h-8" />
        </button>
      )}
      {hasNext && (
        <button className="attachment-preview-nav next" onClick={handleNext} title="Next (Right Arrow)">
          <ChevronRight className="w-8 h-8" />
        </button>
      )}

      {/* Header */}
      <div className="attachment-preview-header">
        <div className="attachment-preview-info">
          <span className="attachment-preview-filename">{attachment.filename}</span>
          <span className="attachment-preview-meta">
            {formatFileSize(attachment.size)} &middot; {attachment.mimeType}
          </span>
        </div>
        <div className="attachment-preview-actions">
          <a
            href={contentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-icon"
            title="Open in new tab"
          >
            <ExternalLink className="w-5 h-5" />
          </a>
          <button className="btn-icon" onClick={handleDownload} title="Download">
            <Download className="w-5 h-5" />
          </button>
          <button className="btn-icon" onClick={onClose} title="Close (Esc)">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="attachment-preview-content">
        {isImage && (
          <img
            src={contentUrl}
            alt={attachment.filename}
            className="attachment-preview-image"
          />
        )}
        {isVideo && (
          <video
            src={contentUrl}
            controls
            autoPlay
            className="attachment-preview-video"
          >
            Your browser does not support the video tag.
          </video>
        )}
        {isPDF && (
          <iframe
            src={contentUrl}
            className="attachment-preview-pdf"
            title={attachment.filename}
          />
        )}
        {!isPreviewable && (
          <div className="attachment-preview-unsupported">
            <p>Preview not available for this file type.</p>
            <p className="text-muted">{attachment.mimeType}</p>
            <button className="btn-primary" onClick={handleDownload}>
              <Download className="w-4 h-4" />
              Download File
            </button>
          </div>
        )}
      </div>

      {/* Counter */}
      {attachments && attachments.length > 1 && (
        <div className="attachment-preview-counter">
          {currentIndex + 1} / {attachments.length}
        </div>
      )}
    </div>
  );
}
