import React, { useState, useMemo } from "react";
import { ChevronRight, ChevronDown, Check, Square } from "lucide-react";
import type { SchemaField, SchemaInputField, SchemaType, ParsedSchema } from "../../hooks/useAppSync";

interface VariablesFieldSelectorProps {
  schema: ParsedSchema | null;
  selectedField: { field: SchemaField; category: "query" | "mutation" | "subscription" } | null;
  variables: string;
  onVariablesChange: (variables: string) => void;
  globalOrgId: string;
}

export function VariablesFieldSelector({
  schema,
  selectedField,
  variables,
  onVariablesChange,
  globalOrgId,
}: VariablesFieldSelectorProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(["root"]));

  // Parse current variables
  const currentVars = useMemo(() => {
    try {
      return JSON.parse(variables || "{}");
    } catch {
      return {};
    }
  }, [variables]);

  // Get the arguments for the selected field
  const args = selectedField?.field.args || [];

  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const getTypeByName = (name: string): SchemaType | undefined => {
    if (!schema) return undefined;
    const typeName = name.replace(/[!\[\]]/g, "").trim();
    return schema.types.find((t) => t.name === typeName);
  };

  const isScalarType = (typeName: string): boolean => {
    const name = typeName.replace(/[!\[\]]/g, "").trim();
    const scalars = ["String", "Int", "Float", "Boolean", "ID", "AWSDateTime", "AWSDate", "AWSTime", "AWSTimestamp", "AWSJSON", "AWSEmail", "AWSURL", "AWSPhone", "AWSIPAddress"];
    return scalars.includes(name);
  };

  // Check if a path exists in the current variables
  const isFieldIncluded = (path: string): boolean => {
    const parts = path.split(".");
    let current: any = currentVars;
    for (const part of parts) {
      if (current === undefined || current === null) return false;
      if (typeof current !== "object") return false;
      if (!(part in current)) return false;
      current = current[part];
    }
    return true;
  };

  // Get default value for a field
  const getDefaultValue = (typeName: string, fieldName: string): any => {
    const baseType = typeName.replace(/[!\[\]]/g, "").trim();
    const isList = typeName.includes("[");
    const name = fieldName.toLowerCase();

    // Special field names
    if (name === "organizationid" || name === "organization_id" || name === "org_id") {
      return globalOrgId || "YOUR_ORG_ID";
    }
    if (name === "page_size" || name === "pagesize" || name === "limit" || name === "take") {
      return 25;
    }
    if (name === "direction") return "ASC";
    if (name === "field" || name === "sortfield") return "updated";
    if (name === "returnhidden" || name === "return_hidden") return true;

    // Check for input type
    const inputType = getTypeByName(baseType);
    if (inputType && inputType.kind === "INPUT_OBJECT" && inputType.inputFields) {
      const obj: Record<string, any> = {};
      for (const f of inputType.inputFields) {
        obj[f.name] = getDefaultValue(f.type, f.name);
      }
      return isList ? [obj] : obj;
    }

    // Scalars
    if (baseType === "Int") return isList ? [1] : 1;
    if (baseType === "Float") return isList ? [0.0] : 0.0;
    if (baseType === "Boolean") return isList ? [true] : true;
    if (baseType === "ID") return isList ? ["1"] : "1";
    if (baseType === "String") return isList ? [""] : "";

    // Enum
    const enumType = schema?.types.find((t) => t.name === baseType && t.kind === "ENUM");
    if (enumType?.enumValues?.length) {
      return isList ? [enumType.enumValues[0]] : enumType.enumValues[0];
    }

    return isList ? [] : {};
  };

  // Toggle a field in/out of the variables
  const handleToggleField = (path: string, typeName: string, fieldName: string) => {
    const parts = path.split(".");
    const newVars = JSON.parse(JSON.stringify(currentVars));

    if (isFieldIncluded(path)) {
      // Remove field
      let current = newVars;
      for (let i = 0; i < parts.length - 1; i++) {
        current = current[parts[i]];
      }
      delete current[parts[parts.length - 1]];
    } else {
      // Add field with default value
      let current = newVars;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!(parts[i] in current)) {
          current[parts[i]] = {};
        }
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = getDefaultValue(typeName, fieldName);
    }

    onVariablesChange(JSON.stringify(newVars, null, 2));
  };

  const renderInputField = (
    field: SchemaInputField,
    path: string,
    depth: number
  ): React.ReactNode => {
    const isScalar = isScalarType(field.type);
    const isIncluded = isFieldIncluded(path);
    const fieldType = getTypeByName(field.type);
    const isExpanded = expandedPaths.has(path);
    const hasChildren = !isScalar && fieldType?.kind === "INPUT_OBJECT" && fieldType.inputFields && fieldType.inputFields.length > 0;

    return (
      <div key={path} className="field-selector-item">
        <div
          className={`field-selector-row ${isIncluded ? "selected" : ""}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => handleToggleField(path, field.type, field.name)}
        >
          {hasChildren ? (
            <button
              className="field-selector-expand"
              onClick={(e) => {
                e.stopPropagation();
                toggleExpand(path);
              }}
            >
              {isExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>
          ) : (
            <span className="field-selector-expand-placeholder" />
          )}

          <span className="field-selector-checkbox">
            {isIncluded ? (
              <Check className="w-3 h-3" />
            ) : (
              <Square className="w-3 h-3" />
            )}
          </span>

          <span className="field-selector-name">{field.name}</span>
          <span className="field-selector-type">{field.type}</span>
        </div>

        {hasChildren && isExpanded && fieldType?.inputFields && (
          <div className="field-selector-children">
            {fieldType.inputFields.map((childField) =>
              renderInputField(childField, `${path}.${childField.name}`, depth + 1)
            )}
          </div>
        )}
      </div>
    );
  };

  if (!selectedField || args.length === 0) {
    return (
      <div className="field-selector field-selector-empty">
        <span>Select a query or mutation to see input fields</span>
      </div>
    );
  }

  return (
    <div className="field-selector">
      <div className="field-selector-list">
        {args.map((arg) => {
          const isScalar = isScalarType(arg.type);
          const isIncluded = isFieldIncluded(arg.name);
          const fieldType = getTypeByName(arg.type);
          const isExpanded = expandedPaths.has(arg.name);
          const hasChildren = !isScalar && fieldType?.kind === "INPUT_OBJECT" && fieldType.inputFields && fieldType.inputFields.length > 0;

          return (
            <div key={arg.name} className="field-selector-item">
              <div
                className={`field-selector-row ${isIncluded ? "selected" : ""}`}
                style={{ paddingLeft: "8px" }}
                onClick={() => handleToggleField(arg.name, arg.type, arg.name)}
              >
                {hasChildren ? (
                  <button
                    className="field-selector-expand"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(arg.name);
                    }}
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                  </button>
                ) : (
                  <span className="field-selector-expand-placeholder" />
                )}

                <span className="field-selector-checkbox">
                  {isIncluded ? (
                    <Check className="w-3 h-3" />
                  ) : (
                    <Square className="w-3 h-3" />
                  )}
                </span>

                <span className="field-selector-name">
                  {arg.name}
                  {arg.type.includes("!") && <span className="field-selector-required">*</span>}
                </span>
                <span className="field-selector-type">{arg.type}</span>
              </div>

              {hasChildren && isExpanded && fieldType?.inputFields && (
                <div className="field-selector-children">
                  {fieldType.inputFields.map((childField) =>
                    renderInputField(childField, `${arg.name}.${childField.name}`, 1)
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
