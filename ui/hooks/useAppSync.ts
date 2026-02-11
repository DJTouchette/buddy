import { useState, useEffect, useCallback } from "react";

export interface AuthState {
  isAuthenticated: boolean;
  accessToken: string | null;
  idToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  isLoading: boolean;
  error: string | null;
}

export interface CognitoSelection {
  userPoolId: string;
  userPoolName: string;
  clientId: string;
  clientName: string;
  region: string;
}

export interface UserPool {
  id: string;
  name: string;
  creationDate?: string;
}

export interface UserPoolClient {
  clientId: string;
  clientName: string;
  userPoolId: string;
}

export interface AppSyncConfig {
  configured: boolean;
  schemaPath: string | null;
  availableSchemas: string[];
  region: string;
  currentEnvironment: string | null;
  stage: string;
  appSyncUrl: string | null;
  cognitoSelection: CognitoSelection | null;
  repoPath: string | null;
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

export interface SchemaType {
  name: string;
  kind: "OBJECT" | "INPUT_OBJECT" | "ENUM" | "SCALAR" | "INTERFACE" | "UNION";
  description?: string;
  fields?: SchemaField[];
  inputFields?: SchemaInputField[];
  enumValues?: string[];
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
  }>;
}

const SESSION_STORAGE_KEY = "appsync_refresh_token";
const SESSION_CREDENTIALS_KEY = "appsync_credentials";

export function useAppSync() {
  const [config, setConfig] = useState<AppSyncConfig | null>(null);
  const [auth, setAuth] = useState<AuthState>({
    isAuthenticated: false,
    accessToken: null,
    idToken: null,
    refreshToken: null,
    expiresAt: null,
    isLoading: false,
    error: null,
  });
  const [schema, setSchema] = useState<ParsedSchema | null>(null);
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);

  // Cognito discovery state
  const [userPools, setUserPools] = useState<UserPool[]>([]);
  const [userPoolClients, setUserPoolClients] = useState<UserPoolClient[]>([]);
  const [poolsLoading, setPoolsLoading] = useState(false);
  const [clientsLoading, setClientsLoading] = useState(false);

  // Load config on mount
  useEffect(() => {
    fetchConfig();
  }, []);

  // Listen for environment changes
  useEffect(() => {
    const handleEnvChange = () => {
      fetchConfig();
      // Clear auth state on environment change since Cognito pools may differ
      logout();
    };

    window.addEventListener("environment-changed", handleEnvChange);
    return () => window.removeEventListener("environment-changed", handleEnvChange);
  }, []);

  // Try to restore session from storage
  useEffect(() => {
    const restoreSession = async () => {
      if (!config?.cognitoSelection || auth.isAuthenticated || auth.isLoading) return;

      // First try refresh token
      const storedRefreshToken = sessionStorage.getItem(SESSION_STORAGE_KEY);
      if (storedRefreshToken) {
        const success = await refreshTokens(storedRefreshToken);
        if (success) return;
      }

      // If no refresh token or it failed, try stored credentials
      await tryReauthWithStoredCredentials();
    };

    restoreSession();
  }, [config?.cognitoSelection]);

  // Auto-refresh tokens before expiry
  useEffect(() => {
    if (!auth.expiresAt || !auth.refreshToken) return;

    // Refresh 1 minute before expiry
    const refreshTime = auth.expiresAt - 60 * 1000;
    const now = Date.now();

    if (refreshTime <= now) {
      refreshTokens(auth.refreshToken);
      return;
    }

    const timeout = setTimeout(() => {
      if (auth.refreshToken) {
        refreshTokens(auth.refreshToken);
      }
    }, refreshTime - now);

    return () => clearTimeout(timeout);
  }, [auth.expiresAt, auth.refreshToken]);

  const fetchConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/appsync/config");
      const data = await response.json();
      setConfig(data);
    } catch (error) {
      console.error("Failed to fetch AppSync config:", error);
    }
  }, []);

  const fetchUserPools = useCallback(async (forceRefresh?: boolean) => {
    setPoolsLoading(true);
    try {
      const refresh = forceRefresh !== false; // Default to true
      const response = await fetch(`/api/appsync/cognito/pools?refresh=${refresh}`);
      const data = await response.json();
      if (data.pools) {
        setUserPools(data.pools);
      }
    } catch (error) {
      console.error("Failed to fetch user pools:", error);
    } finally {
      setPoolsLoading(false);
    }
  }, []);

  const fetchPoolClients = useCallback(async (poolId: string) => {
    setClientsLoading(true);
    setUserPoolClients([]);
    try {
      const response = await fetch(`/api/appsync/cognito/pools/${encodeURIComponent(poolId)}/clients`);
      const data = await response.json();
      if (data.clients) {
        setUserPoolClients(data.clients);
      }
    } catch (error) {
      console.error("Failed to fetch pool clients:", error);
    } finally {
      setClientsLoading(false);
    }
  }, []);

  const selectCognitoConfig = useCallback(async (
    userPoolId: string,
    userPoolName: string,
    clientId: string,
    clientName: string
  ) => {
    try {
      const response = await fetch("/api/appsync/cognito/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userPoolId, userPoolName, clientId, clientName }),
      });

      if (response.ok) {
        await fetchConfig();
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to select Cognito config:", error);
      return false;
    }
  }, [fetchConfig]);

  const clearCognitoSelection = useCallback(async () => {
    try {
      await fetch("/api/appsync/cognito/select", { method: "DELETE" });
      await fetchConfig();
      logout();
    } catch (error) {
      console.error("Failed to clear Cognito selection:", error);
    }
  }, [fetchConfig]);

  const selectSchema = useCallback(async (schemaPath: string) => {
    try {
      const response = await fetch("/api/appsync/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ schemaPath }),
      });

      if (response.ok) {
        await fetchConfig();
        // Invalidate schema cache
        await fetch("/api/appsync/schema/invalidate", { method: "POST" });
        setSchema(null);
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to select schema:", error);
      return false;
    }
  }, [fetchConfig]);

  const login = useCallback(async (email: string, password: string, storeCredentials = true) => {
    setAuth((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await fetch("/api/appsync/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Login failed");
      }

      const expiresAt = Date.now() + data.expiresIn * 1000;

      // Store refresh token in session storage
      sessionStorage.setItem(SESSION_STORAGE_KEY, data.refreshToken);

      // Store credentials for auto re-auth (only in sessionStorage - cleared on tab close)
      if (storeCredentials) {
        sessionStorage.setItem(SESSION_CREDENTIALS_KEY, JSON.stringify({ email, password }));
      }

      setAuth({
        isAuthenticated: true,
        accessToken: data.accessToken,
        idToken: data.idToken,
        refreshToken: data.refreshToken,
        expiresAt,
        isLoading: false,
        error: null,
      });

      return true;
    } catch (error: any) {
      setAuth((prev) => ({
        ...prev,
        isLoading: false,
        error: error.message || "Login failed",
      }));
      return false;
    }
  }, []);

  // Helper to attempt re-auth with stored credentials
  const tryReauthWithStoredCredentials = useCallback(async (): Promise<boolean> => {
    const storedCreds = sessionStorage.getItem(SESSION_CREDENTIALS_KEY);
    if (!storedCreds) return false;

    try {
      const { email, password } = JSON.parse(storedCreds);
      const response = await fetch("/api/appsync/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();
      if (!response.ok) return false;

      const expiresAt = Date.now() + data.expiresIn * 1000;
      sessionStorage.setItem(SESSION_STORAGE_KEY, data.refreshToken);

      setAuth({
        isAuthenticated: true,
        accessToken: data.accessToken,
        idToken: data.idToken,
        refreshToken: data.refreshToken,
        expiresAt,
        isLoading: false,
        error: null,
      });

      return true;
    } catch {
      return false;
    }
  }, []);

  const refreshTokens = useCallback(async (refreshToken: string) => {
    try {
      const response = await fetch("/api/appsync/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Token refresh failed");
      }

      const expiresAt = Date.now() + data.expiresIn * 1000;

      // Update stored refresh token if a new one was returned
      if (data.refreshToken) {
        sessionStorage.setItem(SESSION_STORAGE_KEY, data.refreshToken);
      }

      setAuth({
        isAuthenticated: true,
        accessToken: data.accessToken,
        idToken: data.idToken,
        refreshToken: data.refreshToken || refreshToken,
        expiresAt,
        isLoading: false,
        error: null,
      });

      return true;
    } catch (error) {
      // Try to re-authenticate with stored credentials
      const reauthed = await tryReauthWithStoredCredentials();
      if (reauthed) return true;

      // Clear auth state if both refresh and re-auth fail
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      setAuth({
        isAuthenticated: false,
        accessToken: null,
        idToken: null,
        refreshToken: null,
        expiresAt: null,
        isLoading: false,
        error: null,
      });
      return false;
    }
  }, [tryReauthWithStoredCredentials]);

  const logout = useCallback(async () => {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
    sessionStorage.removeItem(SESSION_CREDENTIALS_KEY);
    setAuth({
      isAuthenticated: false,
      accessToken: null,
      idToken: null,
      refreshToken: null,
      expiresAt: null,
      isLoading: false,
      error: null,
    });

    // Call logout endpoint (mostly for cleanup/analytics)
    try {
      await fetch("/api/appsync/auth/logout", { method: "POST" });
    } catch {
      // Ignore errors
    }
  }, []);

  const fetchSchema = useCallback(async () => {
    setSchemaLoading(true);
    setSchemaError(null);

    try {
      const response = await fetch("/api/appsync/schema");
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch schema");
      }

      setSchema(data.schema);
    } catch (error: any) {
      setSchemaError(error.message || "Failed to fetch schema");
    } finally {
      setSchemaLoading(false);
    }
  }, []);

  const executeQuery = useCallback(
    async (query: string, variables?: Record<string, any>): Promise<GraphQLResponse> => {
      if (!auth.accessToken) {
        // Try to re-auth with stored credentials before failing
        const reauthed = await tryReauthWithStoredCredentials();
        if (!reauthed) {
          throw new Error("Not authenticated");
        }
      }

      const currentToken = auth.accessToken;
      const response = await fetch("/api/appsync/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          variables,
          accessToken: currentToken,
        }),
      });

      const data = await response.json();

      // Handle 401 - try to refresh token, then re-auth
      if (response.status === 401) {
        let refreshed = false;

        if (auth.refreshToken) {
          refreshed = await refreshTokens(auth.refreshToken);
        }

        if (!refreshed) {
          refreshed = await tryReauthWithStoredCredentials();
        }

        if (refreshed) {
          // Retry with new token
          return executeQuery(query, variables);
        }
        throw new Error("Session expired. Please log in again.");
      }

      if (!response.ok && !data.errors) {
        throw new Error(data.error || "Query execution failed");
      }

      return data;
    },
    [auth.accessToken, auth.refreshToken, refreshTokens, tryReauthWithStoredCredentials]
  );

  return {
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
    refreshConfig: fetchConfig,
    fetchUserPools,
    fetchPoolClients,
    selectCognitoConfig,
    clearCognitoSelection,
    selectSchema,
  };
}
