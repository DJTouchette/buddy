import React, { useState, useEffect } from "react";
import { Settings, RefreshCw, Clock, Database, Save, LayoutGrid, ShieldAlert, X, Plus } from "lucide-react";

interface SettingsData {
  settings: {
    pollIntervalMinutes: number;
    protectedEnvironments: string[];
  };
  lastUpdate: string | null;
  nextRefresh: string | null;
}

interface JiraConfigData {
  boardId: number | null;
  hasConfig: boolean;
}

interface CacheInfo {
  tickets: { cachedAt: Date; expiresAt: Date; isExpired: boolean } | null;
  prs: { cachedAt: Date; expiresAt: Date; isExpired: boolean } | null;
  pollIntervalMinutes: number;
  lastRefreshTime: string;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [cacheInfo, setCacheInfo] = useState<CacheInfo | null>(null);
  const [jiraConfig, setJiraConfig] = useState<JiraConfigData | null>(null);
  const [pollInterval, setPollInterval] = useState(5);
  const [boardId, setBoardId] = useState<string>("");
  const [protectedEnvs, setProtectedEnvs] = useState<string[]>([]);
  const [newProtectedEnv, setNewProtectedEnv] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingBoard, setSavingBoard] = useState(false);
  const [savingProtected, setSavingProtected] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const fetchSettings = async () => {
    try {
      const [settingsRes, cacheRes, jiraRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/cache/info"),
        fetch("/api/jira/config"),
      ]);

      const settingsData = await settingsRes.json();
      const cacheData = await cacheRes.json();
      const jiraData = await jiraRes.json();

      setSettings(settingsData);
      setCacheInfo(cacheData);
      setJiraConfig(jiraData);
      setPollInterval(settingsData.settings.pollIntervalMinutes);
      setProtectedEnvs(settingsData.settings.protectedEnvironments || []);
      setBoardId(jiraData.boardId ? String(jiraData.boardId) : "");
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pollIntervalMinutes: pollInterval }),
      });

      if (response.ok) {
        await fetchSettings();
        setMessage({ type: "success", text: "Settings saved successfully" });
      } else {
        setMessage({ type: "error", text: "Failed to save settings" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Failed to save settings" });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBoardId = async () => {
    setSavingBoard(true);
    setMessage(null);

    try {
      const response = await fetch("/api/jira/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ boardId: boardId ? parseInt(boardId) : null }),
      });

      if (response.ok) {
        await fetchSettings();
        setMessage({ type: "success", text: "Board ID saved. Cache cleared - click Refresh to reload tickets in board order." });
      } else {
        setMessage({ type: "error", text: "Failed to save board ID" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Failed to save board ID" });
    } finally {
      setSavingBoard(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setMessage(null);

    try {
      const response = await fetch("/api/refresh", { method: "POST" });

      if (response.ok) {
        await fetchSettings();
        setMessage({ type: "success", text: "Cache refreshed successfully" });
      } else {
        setMessage({ type: "error", text: "Failed to refresh cache" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Failed to refresh cache" });
    } finally {
      setRefreshing(false);
    }
  };

  const handleAddProtectedEnv = async () => {
    if (!newProtectedEnv.trim()) return;
    const envName = newProtectedEnv.trim().toLowerCase();
    if (protectedEnvs.some(e => e.toLowerCase() === envName)) {
      setMessage({ type: "error", text: "Environment already in list" });
      return;
    }

    setSavingProtected(true);
    setMessage(null);

    try {
      const newList = [...protectedEnvs, newProtectedEnv.trim()];
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protectedEnvironments: newList }),
      });

      if (response.ok) {
        setProtectedEnvs(newList);
        setNewProtectedEnv("");
        setMessage({ type: "success", text: "Protected environment added" });
      } else {
        setMessage({ type: "error", text: "Failed to save protected environments" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Failed to save protected environments" });
    } finally {
      setSavingProtected(false);
    }
  };

  const handleRemoveProtectedEnv = async (envToRemove: string) => {
    setSavingProtected(true);
    setMessage(null);

    try {
      const newList = protectedEnvs.filter(e => e !== envToRemove);
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protectedEnvironments: newList }),
      });

      if (response.ok) {
        setProtectedEnvs(newList);
        setMessage({ type: "success", text: "Protected environment removed" });
      } else {
        setMessage({ type: "error", text: "Failed to save protected environments" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Failed to save protected environments" });
    } finally {
      setSavingProtected(false);
    }
  };

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const formatRelativeTime = (dateStr: string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const now = new Date();
    const diff = date.getTime() - now.getTime();

    if (diff < 0) {
      const minutes = Math.abs(Math.floor(diff / 60000));
      if (minutes < 60) return `${minutes} min ago`;
      const hours = Math.floor(minutes / 60);
      return `${hours} hr ago`;
    } else {
      const minutes = Math.floor(diff / 60000);
      if (minutes < 60) return `in ${minutes} min`;
      const hours = Math.floor(minutes / 60);
      return `in ${hours} hr`;
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8 text-muted">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="page-header">
        <h1 className="flex items-center gap-2">
          <Settings className="w-6 h-6" />
          Settings
        </h1>
      </div>

      {message && (
        <div className={`settings-message ${message.type}`}>
          {message.text}
        </div>
      )}

      {/* Cache Settings */}
      <div className="settings-section">
        <h2 className="settings-section-title">
          <Clock className="w-5 h-5" />
          Polling Settings
        </h2>

        <div className="settings-card">
          <div className="settings-field">
            <label htmlFor="pollInterval" className="settings-label">
              Auto-refresh interval (minutes)
            </label>
            <div className="settings-input-group">
              <input
                type="number"
                id="pollInterval"
                min="1"
                max="60"
                value={pollInterval}
                onChange={(e) => setPollInterval(parseInt(e.target.value) || 1)}
                className="settings-input"
              />
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
            <p className="settings-hint">
              Data will automatically refresh every {pollInterval} minute{pollInterval !== 1 ? "s" : ""}.
              Click the Refresh button on any page to manually refresh.
            </p>
          </div>
        </div>
      </div>

      {/* Cache Status */}
      <div className="settings-section">
        <h2 className="settings-section-title">
          <Database className="w-5 h-5" />
          Cache Status
        </h2>

        <div className="settings-card">
          <div className="cache-status-grid">
            <div className="cache-status-item">
              <span className="cache-status-label">Last Update</span>
              <span className="cache-status-value">
                {formatDateTime(settings?.lastUpdate || null)}
              </span>
              {settings?.lastUpdate && (
                <span className="cache-status-relative">
                  {formatRelativeTime(settings.lastUpdate)}
                </span>
              )}
            </div>

            <div className="cache-status-item">
              <span className="cache-status-label">Next Auto-Refresh</span>
              <span className="cache-status-value">
                {formatDateTime(settings?.nextRefresh || null)}
              </span>
              {settings?.nextRefresh && (
                <span className="cache-status-relative">
                  {formatRelativeTime(settings.nextRefresh)}
                </span>
              )}
            </div>
          </div>

          <div className="settings-actions">
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="btn-primary flex items-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              {refreshing ? "Refreshing..." : "Refresh Now"}
            </button>
            <p className="settings-hint">
              Manually refresh all cached data and reset the auto-refresh timer.
            </p>
          </div>
        </div>
      </div>

      {/* JIRA Settings */}
      <div className="settings-section">
        <h2 className="settings-section-title">
          <LayoutGrid className="w-5 h-5" />
          JIRA Board
        </h2>

        <div className="settings-card">
          <div className="settings-field">
            <label htmlFor="boardId" className="settings-label">
              Board ID (for ticket ordering)
            </label>
            <div className="settings-input-group">
              <input
                type="number"
                id="boardId"
                min="1"
                placeholder="e.g., 123"
                value={boardId}
                onChange={(e) => setBoardId(e.target.value)}
                className="settings-input"
              />
              <button
                onClick={handleSaveBoardId}
                disabled={savingBoard}
                className="btn-primary flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {savingBoard ? "Saving..." : "Save"}
              </button>
            </div>
            <p className="settings-hint">
              Find your board ID in the JIRA board URL: <code>/secure/RapidBoard.jspa?rapidView=<strong>123</strong></code>
              <br />
              When set, tickets will be ordered exactly as they appear on your JIRA board.
              {!boardId && " Without a board ID, tickets are sorted by last update time."}
            </p>
          </div>
        </div>
      </div>

      {/* Protected Environments */}
      <div className="settings-section">
        <h2 className="settings-section-title">
          <ShieldAlert className="w-5 h-5" />
          Protected Environments
        </h2>

        <div className="settings-card">
          <div className="settings-field">
            <label className="settings-label">
              Environments where deployments are disabled
            </label>
            <div className="protected-env-list">
              {protectedEnvs.length === 0 ? (
                <p className="text-muted text-sm">No protected environments configured.</p>
              ) : (
                protectedEnvs.map((env) => (
                  <div key={env} className="protected-env-item">
                    <span>{env}</span>
                    <button
                      className="btn-icon-sm btn-danger-icon"
                      onClick={() => handleRemoveProtectedEnv(env)}
                      disabled={savingProtected}
                      title="Remove"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="settings-input-group" style={{ marginTop: "0.75rem" }}>
              <input
                type="text"
                placeholder="e.g., devnext"
                value={newProtectedEnv}
                onChange={(e) => setNewProtectedEnv(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddProtectedEnv()}
                className="settings-input"
              />
              <button
                onClick={handleAddProtectedEnv}
                disabled={savingProtected || !newProtectedEnv.trim()}
                className="btn-primary flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                {savingProtected ? "Adding..." : "Add"}
              </button>
            </div>
            <p className="settings-hint">
              Deployments (both CDK and Lambda) will be blocked for these environments.
              Use this to protect shared or production-like environments from accidental deployments.
            </p>
          </div>
        </div>
      </div>

      {/* About */}
      <div className="settings-section">
        <h2 className="settings-section-title">About</h2>
        <div className="settings-card">
          <p className="text-sm text-muted">
            Buddy UI caches JIRA tickets and Azure DevOps pull requests to provide faster loading times.
            The cache is stored locally in <code>~/.buddy/cache.db</code>.
          </p>
          <p className="text-sm text-muted" style={{ marginTop: "0.5rem" }}>
            Settings are stored in <code>~/.buddy.yaml</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
