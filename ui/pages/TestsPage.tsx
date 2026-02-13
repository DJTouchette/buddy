import React, { useState } from "react";
import { FlaskConical, MonitorCheck, Play } from "lucide-react";
import { CTestPage } from "./CTestPage";
import { E2EPage } from "./E2EPage";
import { PlaywrightPage } from "./PlaywrightPage";

type Tab = "csharp" | "e2e" | "playwright";

interface TestsPageProps {
  navigate: (path: string) => void;
}

export function TestsPage({ navigate }: TestsPageProps) {
  const [activeTab, setActiveTab] = useState<Tab>("csharp");

  return (
    <div className="tests-page">
      <div className="infra-tabs">
        <button
          className={`infra-tab ${activeTab === "csharp" ? "active" : ""}`}
          onClick={() => setActiveTab("csharp")}
        >
          <FlaskConical className="w-4 h-4" />
          C# Tests
        </button>
        <button
          className={`infra-tab ${activeTab === "e2e" ? "active" : ""}`}
          onClick={() => setActiveTab("e2e")}
        >
          <MonitorCheck className="w-4 h-4" />
          E2E
        </button>
        <button
          className={`infra-tab ${activeTab === "playwright" ? "active" : ""}`}
          onClick={() => setActiveTab("playwright")}
        >
          <Play className="w-4 h-4" />
          Playwright
        </button>
      </div>

      {activeTab === "csharp" && <CTestPage navigate={navigate} />}
      {activeTab === "e2e" && <E2EPage />}
      {activeTab === "playwright" && <PlaywrightPage />}
    </div>
  );
}
