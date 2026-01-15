import React, { useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  ExternalLink,
  Loader2,
  KeyRound,
  Server,
  User,
  Building,
  FolderGit,
  GitBranch,
} from "lucide-react";

interface SetupWizardProps {
  onComplete: () => void;
  initialStatus: {
    jira: {
      configured: boolean;
      host?: string;
      email?: string;
    };
    azure: {
      configured: boolean;
      organization?: string;
      project?: string;
      repositoryId?: string;
    };
  };
}

type Step = "jira" | "azure" | "complete";

export function SetupWizard({ onComplete, initialStatus }: SetupWizardProps) {
  // Determine starting step based on what's already configured
  const getInitialStep = (): Step => {
    if (!initialStatus.jira.configured) return "jira";
    if (!initialStatus.azure.configured) return "azure";
    return "complete";
  };

  const [step, setStep] = useState<Step>(getInitialStep());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // JIRA form state - pre-fill from existing config
  const [jiraHost, setJiraHost] = useState(initialStatus.jira.host || "");
  const [jiraEmail, setJiraEmail] = useState(initialStatus.jira.email || "");
  const [jiraToken, setJiraToken] = useState("");

  // Azure form state - pre-fill from existing config
  const [azureOrg, setAzureOrg] = useState(initialStatus.azure.organization || "businessinfusions");
  const [azureProject, setAzureProject] = useState(initialStatus.azure.project || "2Cassadol");
  const [azureToken, setAzureToken] = useState("");
  const [azureRepoId, setAzureRepoId] = useState(initialStatus.azure.repositoryId || "2Cassadol");

  const saveJiraConfig = async () => {
    if (!jiraHost || !jiraEmail || !jiraToken) {
      setError("Please fill in all fields");
      return false;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/setup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jira: {
            host: jiraHost.replace(/^https?:\/\//, "").replace(/\/$/, ""),
            email: jiraEmail,
            apiToken: jiraToken,
          },
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save JIRA config");
      }

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveAzureConfig = async () => {
    if (!azureOrg || !azureProject || !azureToken || !azureRepoId) {
      setError("Please fill in all fields");
      return false;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/setup", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          azure: {
            organization: azureOrg,
            project: azureProject,
            token: azureToken,
            repositoryId: azureRepoId,
          },
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save Azure config");
      }

      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleJiraNext = async () => {
    const success = await saveJiraConfig();
    if (success) {
      if (!initialStatus.azure.configured) {
        setStep("azure");
      } else {
        setStep("complete");
      }
    }
  };

  const handleAzureNext = async () => {
    const success = await saveAzureConfig();
    if (success) {
      setStep("complete");
    }
  };

  const handleComplete = () => {
    onComplete();
  };

  return (
    <div className="setup-wizard-overlay">
      <div className="setup-wizard">
        {/* Progress indicator */}
        <div className="setup-wizard-progress">
          <div className={`setup-progress-step ${step === "jira" ? "active" : initialStatus.jira.configured || step === "azure" || step === "complete" ? "completed" : ""}`}>
            <div className="setup-progress-icon">
              {initialStatus.jira.configured || step === "azure" || step === "complete" ? (
                <Check className="w-4 h-4" />
              ) : (
                <span>1</span>
              )}
            </div>
            <span>JIRA</span>
          </div>
          <div className="setup-progress-line" />
          <div className={`setup-progress-step ${step === "azure" ? "active" : step === "complete" ? "completed" : ""}`}>
            <div className="setup-progress-icon">
              {step === "complete" ? <Check className="w-4 h-4" /> : <span>2</span>}
            </div>
            <span>Azure DevOps</span>
          </div>
          <div className="setup-progress-line" />
          <div className={`setup-progress-step ${step === "complete" ? "active" : ""}`}>
            <div className="setup-progress-icon">
              <span>3</span>
            </div>
            <span>Done</span>
          </div>
        </div>

        {/* JIRA Step */}
        {step === "jira" && (
          <div className="setup-wizard-content">
            <h2 className="setup-wizard-title">
              <KeyRound className="w-6 h-6" />
              Configure JIRA
            </h2>
            <p className="setup-wizard-description">
              Connect to your JIRA instance to view and manage tickets.
            </p>

            <div className="setup-wizard-form">
              <div className="setup-form-field">
                <label>
                  <Server className="w-4 h-4" />
                  JIRA Host
                </label>
                <input
                  type="text"
                  placeholder="your-company.atlassian.net"
                  value={jiraHost}
                  onChange={(e) => setJiraHost(e.target.value)}
                />
                <span className="setup-form-hint">Your Atlassian domain (without https://)</span>
              </div>

              <div className="setup-form-field">
                <label>
                  <User className="w-4 h-4" />
                  Email
                </label>
                <input
                  type="email"
                  placeholder="your.email@company.com"
                  value={jiraEmail}
                  onChange={(e) => setJiraEmail(e.target.value)}
                />
                <span className="setup-form-hint">The email associated with your Atlassian account</span>
              </div>

              <div className="setup-form-field">
                <label>
                  <KeyRound className="w-4 h-4" />
                  API Token
                </label>
                <input
                  type="password"
                  placeholder="Your JIRA API token"
                  value={jiraToken}
                  onChange={(e) => setJiraToken(e.target.value)}
                />
                <div className="setup-form-hint">
                  <a
                    href="https://id.atlassian.com/manage-profile/security/api-tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="setup-form-link"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Create API Token
                  </a>
                  <span> - Click "Create API token" and copy the generated token</span>
                </div>
              </div>
            </div>

            {error && <div className="setup-wizard-error">{error}</div>}

            <div className="setup-wizard-actions">
              <div />
              <button
                className="btn-primary"
                onClick={handleJiraNext}
                disabled={saving || !jiraHost || !jiraEmail || !jiraToken}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Azure Step */}
        {step === "azure" && (
          <div className="setup-wizard-content">
            <h2 className="setup-wizard-title">
              <GitBranch className="w-6 h-6" />
              Configure Azure DevOps
            </h2>
            <p className="setup-wizard-description">
              Connect to Azure DevOps to view and manage pull requests.
            </p>

            <div className="setup-wizard-form">
              <div className="setup-form-field">
                <label>
                  <Building className="w-4 h-4" />
                  Organization
                </label>
                <input
                  type="text"
                  placeholder="businessinfusions"
                  value={azureOrg}
                  onChange={(e) => setAzureOrg(e.target.value)}
                />
                <span className="setup-form-hint">Your Azure DevOps organization name</span>
              </div>

              <div className="setup-form-field">
                <label>
                  <FolderGit className="w-4 h-4" />
                  Project
                </label>
                <input
                  type="text"
                  placeholder="2Cassadol"
                  value={azureProject}
                  onChange={(e) => setAzureProject(e.target.value)}
                />
                <span className="setup-form-hint">The project name in Azure DevOps</span>
              </div>

              <div className="setup-form-field">
                <label>
                  <FolderGit className="w-4 h-4" />
                  Repository ID
                </label>
                <input
                  type="text"
                  placeholder="2Cassadol"
                  value={azureRepoId}
                  onChange={(e) => setAzureRepoId(e.target.value)}
                />
                <span className="setup-form-hint">Usually the same as the project name</span>
              </div>

              <div className="setup-form-field">
                <label>
                  <KeyRound className="w-4 h-4" />
                  Personal Access Token (PAT)
                </label>
                <input
                  type="password"
                  placeholder="Your Azure DevOps PAT"
                  value={azureToken}
                  onChange={(e) => setAzureToken(e.target.value)}
                />
                <div className="setup-form-hint">
                  <a
                    href="https://businessinfusions.visualstudio.com/_usersSettings/tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="setup-form-link"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Create PAT Token
                  </a>
                  <span> - Click "New Token" at the top right, give it Code (Read) scope</span>
                </div>
              </div>
            </div>

            {error && <div className="setup-wizard-error">{error}</div>}

            <div className="setup-wizard-actions">
              {!initialStatus.jira.configured ? (
                <button className="btn-secondary" onClick={() => setStep("jira")} disabled={saving}>
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
              ) : (
                <div />
              )}
              <button
                className="btn-primary"
                onClick={handleAzureNext}
                disabled={saving || !azureOrg || !azureProject || !azureToken || !azureRepoId}
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Complete Step */}
        {step === "complete" && (
          <div className="setup-wizard-content setup-wizard-complete">
            <div className="setup-complete-icon">
              <Check className="w-12 h-12" />
            </div>
            <h2 className="setup-wizard-title">You're All Set!</h2>
            <p className="setup-wizard-description">
              Buddy is now configured and ready to use. Your settings are saved in{" "}
              <code>~/.buddy.yaml</code>.
            </p>

            <div className="setup-wizard-actions">
              <div />
              <button className="btn-primary" onClick={handleComplete}>
                Get Started
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
