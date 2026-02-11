import React, { useState, useMemo } from "react";
import { ChevronRight, ChevronDown, Check, Square } from "lucide-react";
import type { SchemaType, SchemaField, ParsedSchema } from "../../hooks/useAppSync";

interface FieldSelectorProps {
  schema: ParsedSchema | null;
  returnType: string | null;
  selectedFields: Set<string>;
  onToggleField: (fieldPath: string, include: boolean) => void;
  onSelectAll: (fields: string[]) => void;
  onClear: () => void;
}

export function FieldSelector({
  schema,
  returnType,
  selectedFields,
  onToggleField,
  onSelectAll,
  onClear,
}: FieldSelectorProps) {
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set(["root"]));

  // Find the return type in the schema
  const rootType = useMemo(() => {
    if (!schema || !returnType) return null;

    // Strip array brackets and non-null markers
    const typeName = returnType.replace(/[\[\]!]/g, "");

    return schema.types.find((t) => t.name === typeName);
  }, [schema, returnType]);

  const toggleExpand = (path: string) => {
    setExpandedTypes((prev) => {
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
    const typeName = name.replace(/[\[\]!]/g, "");
    return schema.types.find((t) => t.name === typeName);
  };

  const isScalarType = (typeName: string): boolean => {
    const name = typeName.replace(/[\[\]!]/g, "");
    const scalars = ["String", "Int", "Float", "Boolean", "ID", "AWSDateTime", "AWSDate", "AWSTime", "AWSTimestamp", "AWSJSON", "AWSEmail", "AWSURL", "AWSPhone", "AWSIPAddress"];
    return scalars.includes(name);
  };

  const collectScalarFields = (type: SchemaType, prefix: string = ""): string[] => {
    const fields: string[] = [];
    if (type.fields) {
      for (const field of type.fields) {
        const path = prefix ? `${prefix}.${field.name}` : field.name;
        if (isScalarType(field.type)) {
          fields.push(path);
        }
      }
    }
    return fields;
  };

  const handleSelectAllScalars = () => {
    if (!rootType) return;
    const scalarFields = collectScalarFields(rootType);
    onSelectAll(scalarFields);
  };

  const renderField = (
    field: SchemaField,
    path: string,
    depth: number
  ): React.ReactNode => {
    const isScalar = isScalarType(field.type);
    const isSelected = selectedFields.has(path);
    const fieldType = getTypeByName(field.type);
    const isExpanded = expandedTypes.has(path);
    const hasChildren = !isScalar && fieldType?.fields && fieldType.fields.length > 0;

    return (
      <div key={path} className="field-selector-item">
        <div
          className={`field-selector-row ${isSelected ? "selected" : ""}`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => onToggleField(path, !isSelected)}
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
            {isSelected ? (
              <Check className="w-3 h-3" />
            ) : (
              <Square className="w-3 h-3" />
            )}
          </span>

          <span className="field-selector-name">{field.name}</span>
          <span className="field-selector-type">{field.type}</span>
        </div>

        {hasChildren && isExpanded && fieldType?.fields && (
          <div className="field-selector-children">
            {fieldType.fields.map((childField) =>
              renderField(childField, `${path}.${childField.name}`, depth + 1)
            )}
          </div>
        )}
      </div>
    );
  };

  if (!returnType) {
    return (
      <div className="field-selector field-selector-empty">
        <span>Select a query or mutation to see available fields</span>
      </div>
    );
  }

  if (!rootType) {
    return (
      <div className="field-selector field-selector-empty">
        <span>Type "{returnType}" not found in schema</span>
      </div>
    );
  }

  return (
    <div className="field-selector">
      <div className="field-selector-subheader">
        <span className="field-selector-typename">{rootType.name}</span>
        <div className="field-selector-actions">
          <button onClick={handleSelectAllScalars} className="field-selector-action">
            All Scalars
          </button>
          <button onClick={onClear} className="field-selector-action">
            Clear
          </button>
        </div>
      </div>
      <div className="field-selector-list">
        {rootType.fields?.map((field) => renderField(field, field.name, 0))}
      </div>
    </div>
  );
}
