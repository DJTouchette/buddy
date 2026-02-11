import {
  buildSchema,
  introspectionFromSchema,
  type IntrospectionQuery,
  type IntrospectionType,
  type IntrospectionOutputTypeRef,
  type IntrospectionInputTypeRef,
} from "graphql";

export interface SchemaType {
  name: string;
  kind: "OBJECT" | "INPUT_OBJECT" | "ENUM" | "SCALAR" | "INTERFACE" | "UNION";
  description?: string;
  fields?: SchemaField[];
  inputFields?: SchemaInputField[];
  enumValues?: string[];
}

export interface SchemaField {
  name: string;
  description?: string;
  type: string;
  isRequired: boolean;
  isList: boolean;
  args?: SchemaInputField[];
}

export interface SchemaInputField {
  name: string;
  description?: string;
  type: string;
  isRequired: boolean;
  isList: boolean;
  defaultValue?: string;
}

export interface ParsedSchema {
  queries: SchemaField[];
  mutations: SchemaField[];
  subscriptions: SchemaField[];
  types: SchemaType[];
}

export interface GraphQLResponse {
  data?: any;
  errors?: Array<{
    message: string;
    locations?: Array<{ line: number; column: number }>;
    path?: string[];
    extensions?: any;
  }>;
}

export class AppSyncService {
  private cachedSchema: ParsedSchema | null = null;
  private schemaPath: string | null = null;

  constructor(schemaPath?: string) {
    this.schemaPath = schemaPath || null;
  }

  /**
   * Set the schema path
   */
  setSchemaPath(path: string): void {
    this.schemaPath = path;
    this.cachedSchema = null; // Invalidate cache
  }

  /**
   * Parse the GraphQL schema file and return introspection data
   */
  async parseSchema(): Promise<ParsedSchema> {
    if (this.cachedSchema) {
      return this.cachedSchema;
    }

    if (!this.schemaPath) {
      throw new Error("Schema path not configured");
    }

    // Read the schema file
    const file = Bun.file(this.schemaPath);
    const exists = await file.exists();

    if (!exists) {
      throw new Error(`Schema file not found: ${this.schemaPath}`);
    }

    const schemaContent = await file.text();

    // Build the schema and generate introspection
    const schema = buildSchema(schemaContent);
    const introspection = introspectionFromSchema(schema);

    // Parse the introspection data
    this.cachedSchema = this.parseIntrospection(introspection);
    return this.cachedSchema;
  }

  /**
   * Invalidate the cached schema
   */
  invalidateCache(): void {
    this.cachedSchema = null;
  }

  /**
   * Execute a GraphQL query against AppSync
   */
  async executeQuery(
    appSyncUrl: string,
    query: string,
    variables: Record<string, any> | null,
    accessToken: string
  ): Promise<GraphQLResponse> {
    const response = await fetch(appSyncUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: accessToken,
      },
      body: JSON.stringify({
        query,
        variables: variables || {},
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`AppSync request failed: ${response.status} - ${text}`);
    }

    return response.json();
  }

  private parseIntrospection(introspection: IntrospectionQuery): ParsedSchema {
    const schemaTypes = introspection.__schema.types;

    // Find query, mutation, subscription types
    const queryType = schemaTypes.find(
      (t) => t.name === introspection.__schema.queryType?.name
    );
    const mutationType = schemaTypes.find(
      (t) => t.name === introspection.__schema.mutationType?.name
    );
    const subscriptionType = schemaTypes.find(
      (t) => t.name === introspection.__schema.subscriptionType?.name
    );

    // Parse fields
    const queries = this.parseFields(queryType);
    const mutations = this.parseFields(mutationType);
    const subscriptions = this.parseFields(subscriptionType);

    // Parse all types (excluding built-in types)
    const types: SchemaType[] = schemaTypes
      .filter((t) => !t.name.startsWith("__"))
      .filter((t) => t.name !== queryType?.name && t.name !== mutationType?.name && t.name !== subscriptionType?.name)
      .map((t) => this.parseType(t));

    return { queries, mutations, subscriptions, types };
  }

  private parseFields(type: IntrospectionType | undefined): SchemaField[] {
    if (!type || type.kind !== "OBJECT") {
      return [];
    }

    return type.fields.map((field) => ({
      name: field.name,
      description: field.description || undefined,
      type: this.formatType(field.type),
      isRequired: this.isRequired(field.type),
      isList: this.isList(field.type),
      args: field.args.map((arg) => ({
        name: arg.name,
        description: arg.description || undefined,
        type: this.formatInputType(arg.type),
        isRequired: this.isInputRequired(arg.type),
        isList: this.isInputList(arg.type),
        defaultValue: arg.defaultValue || undefined,
      })),
    }));
  }

  private parseType(type: IntrospectionType): SchemaType {
    const base: SchemaType = {
      name: type.name,
      kind: type.kind as SchemaType["kind"],
      description: type.description || undefined,
    };

    if (type.kind === "OBJECT" || type.kind === "INTERFACE") {
      base.fields = type.fields.map((field) => ({
        name: field.name,
        description: field.description || undefined,
        type: this.formatType(field.type),
        isRequired: this.isRequired(field.type),
        isList: this.isList(field.type),
        args: field.args.map((arg) => ({
          name: arg.name,
          description: arg.description || undefined,
          type: this.formatInputType(arg.type),
          isRequired: this.isInputRequired(arg.type),
          isList: this.isInputList(arg.type),
          defaultValue: arg.defaultValue || undefined,
        })),
      }));
    } else if (type.kind === "INPUT_OBJECT") {
      base.inputFields = type.inputFields.map((field) => ({
        name: field.name,
        description: field.description || undefined,
        type: this.formatInputType(field.type),
        isRequired: this.isInputRequired(field.type),
        isList: this.isInputList(field.type),
        defaultValue: field.defaultValue || undefined,
      }));
    } else if (type.kind === "ENUM") {
      base.enumValues = type.enumValues.map((v) => v.name);
    }

    return base;
  }

  private formatType(type: IntrospectionOutputTypeRef): string {
    if (type.kind === "NON_NULL") {
      return `${this.formatType(type.ofType)}!`;
    }
    if (type.kind === "LIST") {
      return `[${this.formatType(type.ofType)}]`;
    }
    return type.name;
  }

  private formatInputType(type: IntrospectionInputTypeRef): string {
    if (type.kind === "NON_NULL") {
      return `${this.formatInputType(type.ofType)}!`;
    }
    if (type.kind === "LIST") {
      return `[${this.formatInputType(type.ofType)}]`;
    }
    return type.name;
  }

  private isRequired(type: IntrospectionOutputTypeRef): boolean {
    return type.kind === "NON_NULL";
  }

  private isList(type: IntrospectionOutputTypeRef): boolean {
    if (type.kind === "NON_NULL") {
      return this.isList(type.ofType);
    }
    return type.kind === "LIST";
  }

  private isInputRequired(type: IntrospectionInputTypeRef): boolean {
    return type.kind === "NON_NULL";
  }

  private isInputList(type: IntrospectionInputTypeRef): boolean {
    if (type.kind === "NON_NULL") {
      return this.isInputList(type.ofType);
    }
    return type.kind === "LIST";
  }
}
