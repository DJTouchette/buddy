import React, { useEffect, useState, useRef, useMemo } from "react";
import { ChevronDown, Cloud, RefreshCw, Search } from "lucide-react";

interface Environment {
  suffix: string;
  stacks: { name: string; status: string }[];
}

export function EnvironmentSelector() {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [currentEnv, setCurrentEnv] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const fetchEnvironments = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/infra/environments");
      const data = await response.json();
      setEnvironments(data.environments || []);
      setCurrentEnv(data.currentEnvironment);
    } catch (error) {
      console.error("Failed to fetch environments:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEnvironments();
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
    if (!isOpen) {
      setSearchQuery("");
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const selectEnvironment = async (env: string) => {
    try {
      await fetch("/api/infra/environments/current", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ environment: env }),
      });
      setCurrentEnv(env);
      setIsOpen(false);

      // Dispatch custom event to notify other components (like InfraPage)
      window.dispatchEvent(new CustomEvent("environment-changed", { detail: { environment: env } }));
    } catch (error) {
      console.error("Failed to set environment:", error);
    }
  };

  // Filter environments based on search query
  const filteredEnvironments = useMemo(() => {
    if (!searchQuery.trim()) return environments;
    const query = searchQuery.toLowerCase();
    return environments.filter((env) =>
      env.suffix.toLowerCase().includes(query)
    );
  }, [environments, searchQuery]);

  return (
    <div className="env-selector" ref={dropdownRef}>
      <button
        className="env-selector-button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={loading}
      >
        <Cloud className="w-4 h-4" />
        <span className="env-selector-label">
          {loading ? "Loading..." : currentEnv || "Select env"}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="env-selector-dropdown">
          <div className="env-selector-header">
            <span>AWS Environments</span>
            <button
              className="btn-icon-sm"
              onClick={(e) => {
                e.stopPropagation();
                fetchEnvironments();
              }}
              title="Refresh environments"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {/* Search Input */}
          <div className="env-selector-search">
            <Search className="w-4 h-4" />
            <input
              ref={searchInputRef}
              type="text"
              placeholder="Search environments..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="env-selector-search-input"
            />
          </div>

          {filteredEnvironments.length === 0 ? (
            <div className="env-selector-empty">
              {loading ? "Loading..." : searchQuery ? "No matches found" : "No environments found"}
            </div>
          ) : (
            <div className="env-selector-list">
              {filteredEnvironments.map((env) => (
                <button
                  key={env.suffix}
                  className={`env-selector-item ${currentEnv === env.suffix ? "active" : ""}`}
                  onClick={() => selectEnvironment(env.suffix)}
                >
                  <span className="env-selector-item-name">{env.suffix}</span>
                  <span className="env-selector-item-count">
                    {env.stacks.length} stack{env.stacks.length !== 1 ? "s" : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
