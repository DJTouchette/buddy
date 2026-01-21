import React, { useEffect } from "react";
import { ExternalLink, GitBranch, GitMerge, User, UserPlus, UserMinus, Users, FileText, CheckCircle, Ticket, Download, Loader2, Check, X, Expand, Maximize2, Minimize2, Pencil, Save, AlertCircle } from "lucide-react";
import { Modal } from "./Modal";
import { NotesEditor } from "./NotesEditor";
import { Markdown } from "./Markdown";
import type { PRWithTicket } from "../../services/linkingService";
import {
  PRStatusBadge,
  ApprovalBadge,
  DetailRow,
  ReviewerItem,
  StatusCheckItem,
  CustomStatusItem,
  usePRCheckout,
  usePRDescription,
  usePRReviewers,
  usePRStatuses,
} from "../shared/pr-detail-shared";

interface PRDetailModalProps {
  pr: PRWithTicket | null;
  jiraHost: string;
  onClose: () => void;
  onTicketClick?: (ticketKey: string) => void;
  onOpenFullPage?: (prId: number) => void;
  onPRUpdate?: (updatedPR: PRWithTicket) => void;
}

export function PRDetailModal({ pr, jiraHost, onClose, onTicketClick, onOpenFullPage, onPRUpdate }: PRDetailModalProps) {
  const sourceBranch = pr?.sourceRefName.replace("refs/heads/", "") || "";
  const targetBranch = pr?.targetRefName.replace("refs/heads/", "") || "";

  // Use shared hooks
  const checkout = usePRCheckout(sourceBranch);
  const description = usePRDescription(pr?.pullRequestId || 0, pr?.description || "");
  const reviewers = usePRReviewers(pr?.pullRequestId || 0);
  const statusData = usePRStatuses(pr?.pullRequestId);

  // Reset state and fetch data when PR changes
  useEffect(() => {
    if (pr) {
      checkout.setCheckoutResult(null);
      checkout.setCurrentBranch(null);
      description.setExpanded(false);
      checkout.fetchCurrentBranch();
      statusData.fetchStatuses();
    }
  }, [pr?.pullRequestId]);

  if (!pr) return null;

  const handleSaveDescription = async () => {
    const newDescription = await description.saveDescription();
    if (newDescription !== null && onPRUpdate) {
      onPRUpdate({ ...pr, description: newDescription });
    }
  };

  const handleAddSelfAsReviewer = async () => {
    const newReviewers = await reviewers.addSelfAsReviewer();
    if (newReviewers && onPRUpdate) {
      onPRUpdate({ ...pr, reviewers: newReviewers });
    }
  };

  const handleRemoveSelfAsReviewer = async () => {
    const newReviewers = await reviewers.removeSelfAsReviewer();
    if (newReviewers && onPRUpdate) {
      onPRUpdate({ ...pr, reviewers: newReviewers });
    }
  };

  const titleExtra = checkout.isCheckedOut ? (
    <div className="checked-out-badge">
      <Check className="w-4 h-4" />
      <span>Checked out</span>
    </div>
  ) : null;

  return (
    <Modal isOpen={!!pr} onClose={onClose} title={`PR #${pr.pullRequestId}`} titleExtra={titleExtra}>
      <div className="pr-detail">
        {/* Header with title */}
        <div className="detail-header">
          <h3 className="detail-summary">{pr.title}</h3>
          <div className="detail-header-actions">
            {!checkout.isCheckedOut && (
              <button
                className="btn-secondary"
                onClick={checkout.handleCheckout}
                disabled={checkout.checkoutLoading}
                title="Checkout this PR branch"
              >
                {checkout.checkoutLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Download className="w-4 h-4" />
                )}
                Checkout
              </button>
            )}
            {onOpenFullPage && (
              <button
                className="btn-secondary"
                onClick={() => onOpenFullPage(pr.pullRequestId)}
                title="Open in full page"
              >
                <Expand className="w-4 h-4" />
                Full Page
              </button>
            )}
            <a href={pr.webUrl} target="_blank" rel="noopener noreferrer" className="btn-link">
              Open in Azure DevOps <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* Checkout result message */}
        {checkout.checkoutResult && (
          <div className={`checkout-result ${checkout.checkoutResult.success ? "success" : "error"}`}>
            {checkout.checkoutResult.success ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
            {checkout.checkoutResult.message}
          </div>
        )}

        {/* Status */}
        <div className="detail-badges">
          <PRStatusBadge status={pr.status} />
          <ApprovalBadge reviewers={pr.reviewers} />
        </div>

        {/* Branch Info */}
        <div className="branch-flow">
          <div className="branch-name">
            <GitBranch className="w-4 h-4" />
            <code>{sourceBranch}</code>
          </div>
          <div className="branch-arrow">→</div>
          <div className="branch-name">
            <GitMerge className="w-4 h-4" />
            <code>{targetBranch}</code>
          </div>
        </div>

        {/* Details Grid */}
        <div className="detail-grid">
          <DetailRow icon={User} label="Created By">
            {pr.createdBy.displayName}
          </DetailRow>

          <DetailRow icon={GitBranch} label="Source Branch">
            <code>{sourceBranch}</code>
          </DetailRow>

          <DetailRow icon={GitMerge} label="Target Branch">
            <code>{targetBranch}</code>
          </DetailRow>
        </div>

        {/* Reviewers Section */}
        <div className="detail-section">
          <div className="detail-section-header">
            <h4 className="detail-section-title">
              <Users className="w-4 h-4" /> Reviewers
              {pr.reviewers && pr.reviewers.length > 0 && (
                <span className="badge badge-sm ml-2">{pr.reviewers.filter(r => !r.isContainer).length}</span>
              )}
            </h4>
            <div className="detail-section-actions">
              <button
                className="btn-sm btn-secondary"
                onClick={handleAddSelfAsReviewer}
                disabled={reviewers.isAddingReviewer || reviewers.isRemovingReviewer}
                title="Add yourself as a reviewer"
              >
                {reviewers.isAddingReviewer ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <UserPlus className="w-3 h-3" />
                )}
                Add myself
              </button>
              <button
                className="btn-sm btn-secondary"
                onClick={handleRemoveSelfAsReviewer}
                disabled={reviewers.isAddingReviewer || reviewers.isRemovingReviewer}
                title="Remove yourself as a reviewer"
              >
                {reviewers.isRemovingReviewer ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <UserMinus className="w-3 h-3" />
                )}
                Remove myself
              </button>
            </div>
          </div>
          {pr.reviewers && pr.reviewers.filter(r => !r.isContainer).length > 0 ? (
            <div className="reviewer-list">
              {pr.reviewers.filter(r => !r.isContainer).map((reviewer) => (
                <ReviewerItem key={reviewer.id} reviewer={reviewer} />
              ))}
            </div>
          ) : (
            <div className="text-muted">No reviewers assigned</div>
          )}
        </div>

        {/* Linked Ticket */}
        {pr.linkedTicket && (
          <div className="detail-section">
            <h4 className="detail-section-title">
              <Ticket className="w-4 h-4" /> Linked JIRA Ticket
            </h4>
            <div className="detail-card clickable-card" onClick={() => onTicketClick?.(pr.linkedTicket!.key)}>
              <div className="detail-card-header">
                <button className="jira-ticket-link">
                  {pr.linkedTicket.key}: {pr.linkedTicket.fields.summary}
                </button>
              </div>
              <div className="detail-card-meta">
                <span className={`badge ${pr.linkedTicket.fields.status.name === "Done" ? "badge-green" : "badge-blue"}`}>
                  {pr.linkedTicket.fields.status.name}
                </span>
                <span className="text-muted text-xs">Click to view ticket</span>
              </div>
            </div>
          </div>
        )}

        {/* Build/Check Statuses */}
        <div className="detail-section">
          <h4 className="detail-section-title">
            <CheckCircle className="w-4 h-4" /> Status Checks
          </h4>
          {statusData.loading ? (
            <div className="text-muted">Loading status checks...</div>
          ) : statusData.checks.length > 0 || statusData.statuses.length > 0 ? (
            <div className="status-list">
              {/* Policy Evaluation Checks (builds, reviewers, etc.) */}
              {statusData.checks.map((check) => (
                <StatusCheckItem key={check.id} check={check} />
              ))}
              {/* Custom Statuses */}
              {statusData.statuses.map((status) => (
                <CustomStatusItem key={status.id} status={status} />
              ))}
            </div>
          ) : (
            <div className="text-muted">No status checks found</div>
          )}
        </div>

        {/* Description */}
        <div className="detail-section">
          <div className="detail-section-header">
            <h4 className="detail-section-title">
              <FileText className="w-4 h-4" /> Description
            </h4>
            <div className="detail-section-actions">
              {!description.isEditing && (
                <>
                  <button
                    className="btn-icon-sm"
                    onClick={description.startEditing}
                    title="Edit description"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  {pr.description && (
                    <button
                      className="btn-icon-sm"
                      onClick={() => description.setExpanded(!description.expanded)}
                      title={description.expanded ? "Collapse" : "Expand"}
                    >
                      {description.expanded ? (
                        <Minimize2 className="w-4 h-4" />
                      ) : (
                        <Maximize2 className="w-4 h-4" />
                      )}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {description.isEditing ? (
            <div className="description-edit">
              <textarea
                className="description-textarea"
                value={description.editedDescription}
                onChange={(e) => description.setEditedDescription(e.target.value)}
                placeholder="Enter description (markdown supported)..."
                rows={10}
                disabled={description.isSaving}
              />
              {description.error && (
                <div className="transition-error">
                  <AlertCircle className="w-4 h-4" />
                  {description.error}
                </div>
              )}
              <div className="description-edit-actions">
                <button
                  className="btn-secondary"
                  onClick={description.cancelEditing}
                  disabled={description.isSaving}
                >
                  <X className="w-4 h-4" />
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={handleSaveDescription}
                  disabled={description.isSaving}
                >
                  {description.isSaving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Save
                </button>
              </div>
            </div>
          ) : pr.description ? (
            <Markdown content={pr.description} className={description.expanded ? "expanded" : ""} />
          ) : (
            <div className="text-muted">No description</div>
          )}
        </div>

        {/* Local Notes */}
        <NotesEditor type="pr" id={String(pr.pullRequestId)} />
      </div>
    </Modal>
  );
}
