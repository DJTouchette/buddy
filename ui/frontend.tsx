import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

import { Layout } from "./components/Layout";
import { SetupWizard } from "./components/SetupWizard";
import { matchRoute } from "./routes";

interface ConfigStatus {
  configured: boolean;
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
}

function App() {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [configStatus, setConfigStatus] = useState<ConfigStatus | null>(null);
  const [checkingConfig, setCheckingConfig] = useState(true);
  const [showWizard, setShowWizard] = useState(false);

  // Check config status on mount
  useEffect(() => {
    const checkConfig = async () => {
      try {
        const response = await fetch("/api/status");
        const data = await response.json();
        setConfigStatus(data);
        setShowWizard(!data.configured);
      } catch (err) {
        console.error("Failed to check config:", err);
        // If we can't check, assume not configured
        setShowWizard(true);
      } finally {
        setCheckingConfig(false);
      }
    };
    checkConfig();
  }, []);

  useEffect(() => {
    const handlePopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, "", path);
    setCurrentPath(path);
  };

  const renderPage = () => {
    const { component: Component, params } = matchRoute(currentPath);
    // TicketDetailPage expects ticketKey to be uppercase
    const processedParams = { ...params };
    if (processedParams.ticketKey) {
      processedParams.ticketKey = processedParams.ticketKey.toUpperCase();
    }
    return <Component navigate={navigate} {...processedParams} />;
  };

  // Show loading while checking config
  if (checkingConfig) {
    return (
      <div className="setup-loading">
        <div className="setup-loading-spinner" />
        <span>Loading...</span>
      </div>
    );
  }

  // Show wizard if not configured
  if (showWizard && configStatus) {
    return (
      <SetupWizard
        initialStatus={configStatus}
        onComplete={() => {
          setShowWizard(false);
          // Reload the page to reinitialize everything with new config
          window.location.reload();
        }}
      />
    );
  }

  return (
    <Layout currentPath={currentPath} navigate={navigate}>
      {renderPage()}
    </Layout>
  );
}

const container = document.getElementById("root");
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}
