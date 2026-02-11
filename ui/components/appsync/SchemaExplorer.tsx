import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Search,
  ChevronRight,
  ChevronDown,
  FileText,
  Type,
  List,
  Hash,
  Box,
  ArrowRight,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { ParsedSchema, SchemaType, SchemaField } from "../../hooks/useAppSync";

interface SchemaExplorerProps {
  schema: ParsedSchema | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelectField: (field: SchemaField, category: "query" | "mutation" | "subscription") => void;
  onSelectType: (type: SchemaType) => void;
}

type Category = "queries" | "mutations" | "subscriptions" | "types";

interface CategoryState {
  queries: boolean;
  mutations: boolean;
  subscriptions: boolean;
  types: boolean;
}

const VIRTUAL_SCROLL_ITEM_HEIGHT = 32;
const VIRTUAL_SCROLL_BUFFER = 5;

export function SchemaExplorer({
  schema,
  loading,
  error,
  onRefresh,
  onSelectField,
  onSelectType,
}: SchemaExplorerProps) {
  const [search, setSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<CategoryState>({
    queries: true,
    mutations: false,
    subscriptions: false,
    types: false,
  });
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<"all" | "OBJECT" | "INPUT_OBJECT" | "ENUM">("all");

  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);

  // Update container height on resize
  useEffect(() => {
    const updateHeight = () => {
      if (listRef.current) {
        setContainerHeight(listRef.current.clientHeight);
      }
    };
    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const toggleCategory = (category: Category) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  const toggleType = (typeName: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(typeName)) {
        next.delete(typeName);
      } else {
        next.add(typeName);
      }
      return next;
    });
  };

  // Filter and organize schema data
  const filteredData = useMemo(() => {
    if (!schema) return null;

    const searchLower = search.toLowerCase();
    const filterBySearch = (items: SchemaField[]) =>
      items.filter(
        (item) =>
          item.name.toLowerCase().includes(searchLower) ||
          item.description?.toLowerCase().includes(searchLower)
      );

    const filterTypes = (types: SchemaType[]) =>
      types.filter((type) => {
        if (typeFilter !== "all" && type.kind !== typeFilter) return false;
        if (!search) return true;
        return (
          type.name.toLowerCase().includes(searchLower) ||
          type.description?.toLowerCase().includes(searchLower) ||
          type.fields?.some((f) => f.name.toLowerCase().includes(searchLower)) ||
          type.inputFields?.some((f) => f.name.toLowerCase().includes(searchLower)) ||
          type.enumValues?.some((v) => v.toLowerCase().includes(searchLower))
        );
      });

    return {
      queries: filterBySearch(schema.queries),
      mutations: filterBySearch(schema.mutations),
      subscriptions: filterBySearch(schema.subscriptions),
      types: filterTypes(schema.types),
    };
  }, [schema, search, typeFilter]);

  // Count stats
  const stats = useMemo(() => {
    if (!schema) return null;
    return {
      queries: schema.queries.length,
      mutations: schema.mutations.length,
      subscriptions: schema.subscriptions.length,
      types: schema.types.length,
    };
  }, [schema]);

  const getTypeIcon = (kind: string) => {
    switch (kind) {
      case "OBJECT":
        return <Box className="w-3 h-3 text-blue-500" />;
      case "INPUT_OBJECT":
        return <ArrowRight className="w-3 h-3 text-green-500" />;
      case "ENUM":
        return <List className="w-3 h-3 text-purple-500" />;
      case "SCALAR":
        return <Hash className="w-3 h-3 text-orange-500" />;
      default:
        return <Type className="w-3 h-3" />;
    }
  };

  if (loading) {
    return (
      <div className="appsync-schema-explorer appsync-schema-loading">
        <Loader2 className="w-6 h-6 animate-spin" />
        <span>Loading schema...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="appsync-schema-explorer appsync-schema-error">
        <span>{error}</span>
        <button onClick={onRefresh} className="btn-secondary">
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  if (!schema || !filteredData) {
    return (
      <div className="appsync-schema-explorer appsync-schema-empty">
        <FileText className="w-6 h-6" />
        <span>No schema loaded</span>
        <button onClick={onRefresh} className="btn-primary">
          Load Schema
        </button>
      </div>
    );
  }

  return (
    <div className="appsync-schema-explorer">
      <div className="appsync-schema-header">
        <div className="appsync-schema-search">
          <Search className="w-4 h-4" />
          <input
            type="text"
            placeholder="Search schema..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button onClick={onRefresh} className="btn-icon-sm" title="Refresh schema">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {stats && (
        <div className="appsync-schema-stats">
          <span title="Queries">{stats.queries} Q</span>
          <span title="Mutations">{stats.mutations} M</span>
          <span title="Subscriptions">{stats.subscriptions} S</span>
          <span title="Types">{stats.types} T</span>
        </div>
      )}

      <div className="appsync-schema-list" ref={listRef} onScroll={handleScroll}>
        {/* Queries */}
        <div className="appsync-schema-category">
          <button
            className="appsync-schema-category-header"
            onClick={() => toggleCategory("queries")}
          >
            {expandedCategories.queries ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <span>Queries</span>
            <span className="appsync-schema-count">{filteredData.queries.length}</span>
          </button>
          {expandedCategories.queries && (
            <div className="appsync-schema-items">
              {filteredData.queries.map((field) => (
                <button
                  key={field.name}
                  className="appsync-schema-item"
                  onClick={() => onSelectField(field, "query")}
                  title={field.description}
                >
                  <span className="appsync-schema-item-name">{field.name}</span>
                  <span className="appsync-schema-item-type">{field.type}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Mutations */}
        <div className="appsync-schema-category">
          <button
            className="appsync-schema-category-header"
            onClick={() => toggleCategory("mutations")}
          >
            {expandedCategories.mutations ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <span>Mutations</span>
            <span className="appsync-schema-count">{filteredData.mutations.length}</span>
          </button>
          {expandedCategories.mutations && (
            <div className="appsync-schema-items">
              {filteredData.mutations.map((field) => (
                <button
                  key={field.name}
                  className="appsync-schema-item"
                  onClick={() => onSelectField(field, "mutation")}
                  title={field.description}
                >
                  <span className="appsync-schema-item-name">{field.name}</span>
                  <span className="appsync-schema-item-type">{field.type}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Subscriptions */}
        {filteredData.subscriptions.length > 0 && (
          <div className="appsync-schema-category">
            <button
              className="appsync-schema-category-header"
              onClick={() => toggleCategory("subscriptions")}
            >
              {expandedCategories.subscriptions ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              <span>Subscriptions</span>
              <span className="appsync-schema-count">{filteredData.subscriptions.length}</span>
            </button>
            {expandedCategories.subscriptions && (
              <div className="appsync-schema-items">
                {filteredData.subscriptions.map((field) => (
                  <button
                    key={field.name}
                    className="appsync-schema-item"
                    onClick={() => onSelectField(field, "subscription")}
                    title={field.description}
                  >
                    <span className="appsync-schema-item-name">{field.name}</span>
                    <span className="appsync-schema-item-type">{field.type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Types */}
        <div className="appsync-schema-category">
          <button
            className="appsync-schema-category-header"
            onClick={() => toggleCategory("types")}
          >
            {expandedCategories.types ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            <span>Types</span>
            <span className="appsync-schema-count">{filteredData.types.length}</span>
          </button>
          {expandedCategories.types && (
            <>
              <div className="appsync-type-filters">
                <button
                  className={`appsync-type-filter ${typeFilter === "all" ? "active" : ""}`}
                  onClick={() => setTypeFilter("all")}
                >
                  All
                </button>
                <button
                  className={`appsync-type-filter ${typeFilter === "OBJECT" ? "active" : ""}`}
                  onClick={() => setTypeFilter("OBJECT")}
                >
                  Objects
                </button>
                <button
                  className={`appsync-type-filter ${typeFilter === "INPUT_OBJECT" ? "active" : ""}`}
                  onClick={() => setTypeFilter("INPUT_OBJECT")}
                >
                  Inputs
                </button>
                <button
                  className={`appsync-type-filter ${typeFilter === "ENUM" ? "active" : ""}`}
                  onClick={() => setTypeFilter("ENUM")}
                >
                  Enums
                </button>
              </div>
              <div className="appsync-schema-items appsync-schema-types">
                {filteredData.types.map((type) => (
                  <div key={type.name} className="appsync-type-item">
                    <button
                      className="appsync-schema-item"
                      onClick={() => {
                        if (type.fields || type.inputFields || type.enumValues) {
                          toggleType(type.name);
                        }
                        onSelectType(type);
                      }}
                      title={type.description}
                    >
                      {(type.fields || type.inputFields || type.enumValues) && (
                        expandedTypes.has(type.name) ? (
                          <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronRight className="w-3 h-3" />
                        )
                      )}
                      {getTypeIcon(type.kind)}
                      <span className="appsync-schema-item-name">{type.name}</span>
                      <span className="appsync-schema-item-kind">{type.kind}</span>
                    </button>
                    {expandedTypes.has(type.name) && (
                      <div className="appsync-type-fields">
                        {type.fields?.map((field) => (
                          <div key={field.name} className="appsync-type-field">
                            <span className="appsync-type-field-name">{field.name}</span>
                            <span className="appsync-type-field-type">
                              {field.isRequired ? "" : "?"}
                              {field.type}
                            </span>
                          </div>
                        ))}
                        {type.inputFields?.map((field) => (
                          <div key={field.name} className="appsync-type-field">
                            <span className="appsync-type-field-name">{field.name}</span>
                            <span className="appsync-type-field-type">
                              {field.isRequired ? "" : "?"}
                              {field.type}
                            </span>
                          </div>
                        ))}
                        {type.enumValues?.map((value) => (
                          <div key={value} className="appsync-type-field appsync-enum-value">
                            <span className="appsync-type-field-name">{value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
