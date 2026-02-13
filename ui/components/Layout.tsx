import React, { useState, useEffect } from "react";
import { Moon, Sun, Settings, GitBranch, ChevronDown } from "lucide-react";
import { useTheme } from "../hooks/useTheme";
import { EnvironmentSelector } from "./EnvironmentSelector";

interface StoredRepo {
  id: number;
  path: string;
  name: string;
  isWsl: boolean;
  lastScanned: number;
}

interface LayoutProps {
  children: React.ReactNode;
  currentPath: string;
  navigate: (path: string) => void;
}

export function Layout({ children, currentPath, navigate }: LayoutProps) {
  const { theme, toggleTheme } = useTheme();
  const [selectedRepo, setSelectedRepo] = useState<StoredRepo | null>(null);

  useEffect(() => {
    // Fetch selected repo on mount
    const fetchSelectedRepo = async () => {
      try {
        const response = await fetch("/api/repos/selected");
        const data = await response.json();
        setSelectedRepo(data.selectedRepo);
      } catch (err) {
        console.error("Failed to fetch selected repo:", err);
      }
    };

    fetchSelectedRepo();

    // Set up interval to check for changes
    const interval = setInterval(fetchSelectedRepo, 5000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { path: "/dashboard", label: "Dashboard" },
    { path: "/tickets", label: "Tickets" },
    { path: "/prs", label: "Pull Requests" },
    { path: "/git", label: "Git" },
    { path: "/infra", label: "Infrastructure" },
    { path: "/appsync", label: "AppSync" },
    { path: "/jobs", label: "Jobs" },
    { path: "/tests", label: "Tests" },
    { path: "/ai-docs", label: "AI" },
  ];

  const isActive = (path: string) => {
    if (path === "/dashboard") {
      return currentPath === "/" || currentPath === "/dashboard";
    }
    return currentPath === path;
  };

  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center">
              <div className="font-semibold text-lg mr-8">Buddy</div>
              <nav className="flex gap-6">
                {navItems.map((item) => (
                  <button
                    key={item.path}
                    onClick={() => navigate(item.path)}
                    className={`nav-link ${isActive(item.path) ? "active" : ""}`}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>
            <div className="flex items-center gap-2">
              <EnvironmentSelector />
              <div className="nav-divider" />
              {selectedRepo && (
                <>
                  <button
                    onClick={() => navigate("/git")}
                    className="repo-selector"
                    title={selectedRepo.path}
                  >
                    <GitBranch className="w-4 h-4" />
                    <span className="repo-selector-name">{selectedRepo.name}</span>
                    {selectedRepo.isWsl ? (
                      <span className="badge badge-wsl badge-sm">WSL</span>
                    ) : (
                      <span className="badge badge-windows badge-sm">WIN</span>
                    )}
                  </button>
                  <div className="nav-divider" />
                </>
              )}
              <button
                onClick={() => navigate("/settings")}
                className={`btn-icon ${currentPath === "/settings" ? "active" : ""}`}
                title="Settings"
              >
                <Settings className="w-5 h-5" />
              </button>
              <button onClick={toggleTheme} className="btn-icon" title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}>
                {theme === "light" ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
