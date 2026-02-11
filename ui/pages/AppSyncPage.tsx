import React, { useState, useEffect } from "react";
import { Cloud, AlertCircle, ExternalLink, Settings, ChevronDown, Check, Loader2, X, RefreshCw } from "lucide-react";
import { useAppSync } from "../hooks/useAppSync";
import { AuthPanel } from "../components/appsync/AuthPanel";
import { SchemaExplorer } from "../components/appsync/SchemaExplorer";
import { QueryBuilder } from "../components/appsync/QueryBuilder";
import { ResponseViewer } from "../components/appsync/ResponseViewer";
import type { SchemaField, SchemaType, GraphQLResponse, UserPool, UserPoolClient } from "../hooks/useAppSync";

export function AppSyncPage() {
  const {
    config,
    auth,
    schema,
    schemaLoading,
    schemaError,
    userPools,
    userPoolClients,
    poolsLoading,
    clientsLoading,
    login,
    logout,
    fetchSchema,
    executeQuery,
    refreshConfig,
    fetchUserPools,
    fetchPoolClients,
    selectCognitoConfig,
    clearCognitoSelection,
    selectSchema,
  } = useAppSync();

  const [query, setQuery] = useState("");
  const [variables, setVariables] = useState("");
  const [response, setResponse] = useState<GraphQLResponse | null>(null);
  const [responseLoading, setResponseLoading] = useState(false);
  const [responseError, setResponseError] = useState<string | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const [selectedField, setSelectedField] = useState<{
    field: SchemaField;
    category: "query" | "mutation" | "subscription";
  } | null>(null);

  // Setup wizard state
  const [showSetup, setShowSetup] = useState(false);
  const [selectedPool, setSelectedPool] = useState<UserPool | null>(null);
  const [selectedClient, setSelectedClient] = useState<UserPoolClient | null>(null);

  // Load schema when authenticated
  useEffect(() => {
    if (auth.isAuthenticated && config?.schemaPath && !schema && !schemaLoading) {
      fetchSchema();
    }
  }, [auth.isAuthenticated, config?.schemaPath]);

  // Show setup if not configured
  useEffect(() => {
    if (config && !config.cognitoSelection) {
      setShowSetup(true);
    }
  }, [config?.cognitoSelection]);

  const handleExecute = async () => {
    if (!query.trim()) return;

    setResponseLoading(true);
    setResponseError(null);
    setResponse(null);
    setExecutionTime(null);

    const startTime = Date.now();

    try {
      let vars: Record<string, any> | undefined;
      if (variables.trim()) {
        try {
          vars = JSON.parse(variables);
        } catch (e: any) {
          setResponseError(`Invalid variables JSON: ${e.message}`);
          setResponseLoading(false);
          return;
        }
      }

      const result = await executeQuery(query, vars);
      setExecutionTime(Date.now() - startTime);
      setResponse(result);
    } catch (error: any) {
      setExecutionTime(Date.now() - startTime);
      setResponseError(error.message || "Query execution failed");
    } finally {
      setResponseLoading(false);
    }
  };

  const handleSelectField = (
    field: SchemaField,
    category: "query" | "mutation" | "subscription"
  ) => {
    setSelectedField({ field, category });
  };

  const handleSelectType = (type: SchemaType) => {
    console.log("Selected type:", type.name);
  };

  const handlePoolSelect = async (pool: UserPool) => {
    setSelectedPool(pool);
    setSelectedClient(null);
    await fetchPoolClients(pool.id);
  };

  const handleClientSelect = async (client: UserPoolClient) => {
    setSelectedClient(client);
  };

  const handleConfirmSelection = async () => {
    if (selectedPool && selectedClient) {
      const success = await selectCognitoConfig(
        selectedPool.id,
        selectedPool.name,
        selectedClient.clientId,
        selectedClient.clientName
      );
      if (success) {
        setShowSetup(false);
        setSelectedPool(null);
        setSelectedClient(null);
      }
    }
  };

  const handleSchemaSelect = async (path: string) => {
    await selectSchema(path);
  };

  // Loading state
  if (!config) {
    return (
      <div className="appsync-page">
        <div className="appsync-page-header">
          <div className="appsync-page-title">
            <Cloud className="w-6 h-6" />
            <h1>AppSync GraphQL</h1>
          </div>
        </div>
        <div className="appsync-loading">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading configuration...
        </div>
      </div>
    );
  }

  // Setup wizard
  if (showSetup || !config.cognitoSelection) {
    return (
      <div className="appsync-page">
        <div className="appsync-page-header">
          <div className="appsync-page-title">
            <Cloud className="w-6 h-6" />
            <h1>AppSync GraphQL</h1>
            {config.currentEnvironment && (
              <span className="badge badge-blue">{config.currentEnvironment}</span>
            )}
          </div>
        </div>

        <div className="appsync-setup">
          <div className="appsync-setup-header">
            <Settings className="w-5 h-5" />
            <h2>Configure AppSync Connection</h2>
          </div>

          <div className="appsync-setup-content">
            {/* Step 1: Select Cognito User Pool */}
            <div className="appsync-setup-step">
              <div className="appsync-setup-step-header">
                <span className="appsync-setup-step-number">1</span>
                <span>Select Cognito User Pool</span>
                {!userPools.length && !poolsLoading && (
                  <button onClick={() => fetchUserPools()} className="btn-secondary btn-sm">
                    <RefreshCw className="w-3 h-3" />
                    Load Pools
                  </button>
                )}
              </div>

              {poolsLoading ? (
                <div className="appsync-setup-loading">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading User Pools from AWS...
                </div>
              ) : userPools.length > 0 ? (
                <div className="appsync-setup-list">
                  {userPools.map((pool) => (
                    <button
                      key={pool.id}
                      className={`appsync-setup-option ${selectedPool?.id === pool.id ? "selected" : ""}`}
                      onClick={() => handlePoolSelect(pool)}
                    >
                      <span className="appsync-setup-option-name">{pool.name}</span>
                      <span className="appsync-setup-option-id">{pool.id}</span>
                      {selectedPool?.id === pool.id && <Check className="w-4 h-4" />}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="appsync-setup-empty">
                  Click "Load Pools" to fetch Cognito User Pools from AWS
                </div>
              )}
            </div>

            {/* Step 2: Select App Client */}
            {selectedPool && (
              <div className="appsync-setup-step">
                <div className="appsync-setup-step-header">
                  <span className="appsync-setup-step-number">2</span>
                  <span>Select App Client</span>
                </div>

                {clientsLoading ? (
                  <div className="appsync-setup-loading">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Loading clients...
                  </div>
                ) : userPoolClients.length > 0 ? (
                  <div className="appsync-setup-list">
                    {userPoolClients.map((client) => (
                      <button
                        key={client.clientId}
                        className={`appsync-setup-option ${selectedClient?.clientId === client.clientId ? "selected" : ""}`}
                        onClick={() => handleClientSelect(client)}
                      >
                        <span className="appsync-setup-option-name">{client.clientName}</span>
                        <span className="appsync-setup-option-id">{client.clientId}</span>
                        {selectedClient?.clientId === client.clientId && <Check className="w-4 h-4" />}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="appsync-setup-empty">No app clients found for this pool</div>
                )}
              </div>
            )}

            {/* Step 3: Confirm */}
            {selectedPool && selectedClient && (
              <div className="appsync-setup-step">
                <div className="appsync-setup-step-header">
                  <span className="appsync-setup-step-number">3</span>
                  <span>Confirm Selection</span>
                </div>

                <div className="appsync-setup-summary">
                  <div className="appsync-setup-summary-item">
                    <span>User Pool:</span>
                    <span>{selectedPool.name}</span>
                  </div>
                  <div className="appsync-setup-summary-item">
                    <span>App Client:</span>
                    <span>{selectedClient.clientName}</span>
                  </div>
                  {config.currentEnvironment && (
                    <div className="appsync-setup-summary-item">
                      <span>Environment:</span>
                      <span>{config.currentEnvironment}</span>
                    </div>
                  )}
                  {config.appSyncUrl && (
                    <div className="appsync-setup-summary-item">
                      <span>AppSync URL:</span>
                      <span className="appsync-setup-url">{config.appSyncUrl}</span>
                    </div>
                  )}
                </div>

                <button onClick={handleConfirmSelection} className="btn-primary">
                  <Check className="w-4 h-4" />
                  Use This Configuration
                </button>
              </div>
            )}

            {/* Schema selection (optional) */}
            {config.availableSchemas && config.availableSchemas.length > 1 && (
              <div className="appsync-setup-step">
                <div className="appsync-setup-step-header">
                  <span className="appsync-setup-step-number">+</span>
                  <span>Select Schema (optional)</span>
                </div>
                <div className="appsync-setup-list">
                  {config.availableSchemas.map((schemaPath) => (
                    <button
                      key={schemaPath}
                      className={`appsync-setup-option ${config.schemaPath === schemaPath ? "selected" : ""}`}
                      onClick={() => handleSchemaSelect(schemaPath)}
                    >
                      <span className="appsync-setup-option-name">
                        {schemaPath.split("/").slice(-2).join("/")}
                      </span>
                      {config.schemaPath === schemaPath && <Check className="w-4 h-4" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Status info */}
          <div className="appsync-setup-info">
            {!config.currentEnvironment && (
              <div className="appsync-setup-warning">
                <AlertCircle className="w-4 h-4" />
                No environment selected. Select one from the header dropdown.
              </div>
            )}
            {config.schemaPath && (
              <div className="appsync-setup-info-item">
                Schema: {config.schemaPath.split("/").slice(-2).join("/")}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="appsync-page">
      <div className="appsync-page-header">
        <div className="appsync-page-title">
          <Cloud className="w-6 h-6" />
          <h1>AppSync GraphQL</h1>
          {config.currentEnvironment && (
            <span className="badge badge-blue">{config.currentEnvironment}</span>
          )}
        </div>
        <div className="appsync-page-actions">
          {config.cognitoSelection && (
            <button
              onClick={() => setShowSetup(true)}
              className="btn-icon-sm"
              title={`Using: ${config.cognitoSelection.userPoolName}`}
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
          {config.appSyncUrl && (
            <a
              href={config.appSyncUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="appsync-endpoint-link"
              title={config.appSyncUrl}
            >
              <ExternalLink className="w-4 h-4" />
              Endpoint
            </a>
          )}
        </div>
      </div>

      <div className="appsync-main">
        {/* Auth Panel */}
        <AuthPanel
          isAuthenticated={auth.isAuthenticated}
          isLoading={auth.isLoading}
          error={auth.error}
          currentEnvironment={config.currentEnvironment}
          stage={config.stage}
          onLogin={login}
          onLogout={logout}
        />

        {auth.isAuthenticated ? (
          <div className="appsync-workspace">
            {/* Schema Explorer */}
            <div className="appsync-sidebar">
              <SchemaExplorer
                schema={schema}
                loading={schemaLoading}
                error={schemaError}
                onRefresh={fetchSchema}
                onSelectField={handleSelectField}
                onSelectType={handleSelectType}
              />
            </div>

            {/* Query Builder and Response */}
            <div className="appsync-main-panel">
              <div className="appsync-query-panel">
                <QueryBuilder
                  query={query}
                  variables={variables}
                  onQueryChange={setQuery}
                  onVariablesChange={setVariables}
                  onExecute={handleExecute}
                  isExecuting={responseLoading}
                  selectedField={selectedField}
                  schema={schema}
                />
              </div>
              <div className="appsync-response-panel">
                <ResponseViewer
                  response={response}
                  loading={responseLoading}
                  error={responseError}
                  executionTime={executionTime}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="appsync-auth-required">
            <p>Sign in to access the GraphQL explorer</p>
          </div>
        )}
      </div>
    </div>
  );
}
