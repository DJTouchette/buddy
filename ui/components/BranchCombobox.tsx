import React, { useState, useRef, useEffect, useMemo } from "react";
import { GitBranch, ChevronDown, Check, Search } from "lucide-react";

interface BranchComboboxProps {
  value: string;
  onChange: (value: string) => void;
  branches: string[];
  baseBranches: string[];
  placeholder?: string;
}

export function BranchCombobox({
  value,
  onChange,
  branches,
  baseBranches,
  placeholder = "Select target branch...",
}: BranchComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Filter branches based on search
  const filteredBaseBranches = useMemo(() => {
    const searchLower = search.toLowerCase();
    return baseBranches.filter((b) => b.toLowerCase().includes(searchLower));
  }, [baseBranches, search]);

  const filteredOtherBranches = useMemo(() => {
    const searchLower = search.toLowerCase();
    return branches
      .filter((b) => !baseBranches.includes(b))
      .filter((b) => b.toLowerCase().includes(searchLower));
  }, [branches, baseBranches, search]);

  const handleSelect = (branch: string) => {
    onChange(branch);
    setIsOpen(false);
    setSearch("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      setSearch("");
    } else if (e.key === "Enter" && !isOpen) {
      setIsOpen(true);
    }
  };

  return (
    <div className="branch-combobox" ref={containerRef}>
      <button
        type="button"
        className="branch-combobox-trigger"
        onClick={() => setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
      >
        <GitBranch className="w-4 h-4" />
        <span className={value ? "branch-value" : "branch-placeholder"}>
          {value || placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 chevron ${isOpen ? "rotate" : ""}`} />
      </button>

      {isOpen && (
        <div className="branch-combobox-dropdown">
          <div className="branch-combobox-search">
            <Search className="w-4 h-4" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search branches..."
              className="branch-search-input"
              onKeyDown={handleKeyDown}
            />
          </div>

          <div className="branch-combobox-options">
            {filteredBaseBranches.length > 0 && (
              <div className="branch-group">
                <div className="branch-group-label">Base Branches</div>
                {filteredBaseBranches.map((branch) => (
                  <button
                    key={branch}
                    type="button"
                    className={`branch-option ${value === branch ? "selected" : ""}`}
                    onClick={() => handleSelect(branch)}
                  >
                    <span className="branch-option-name">{branch}</span>
                    {value === branch && <Check className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            )}

            {filteredOtherBranches.length > 0 && (
              <div className="branch-group">
                <div className="branch-group-label">All Branches</div>
                {filteredOtherBranches.slice(0, 50).map((branch) => (
                  <button
                    key={branch}
                    type="button"
                    className={`branch-option ${value === branch ? "selected" : ""}`}
                    onClick={() => handleSelect(branch)}
                  >
                    <span className="branch-option-name">{branch}</span>
                    {value === branch && <Check className="w-4 h-4" />}
                  </button>
                ))}
                {filteredOtherBranches.length > 50 && (
                  <div className="branch-more-hint">
                    Type to search {filteredOtherBranches.length - 50} more branches...
                  </div>
                )}
              </div>
            )}

            {filteredBaseBranches.length === 0 && filteredOtherBranches.length === 0 && (
              <div className="branch-no-results">No branches found</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
