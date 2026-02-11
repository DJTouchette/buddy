import { CognitoService } from "../../services/cognitoService";
import { AppSyncService } from "../../services/appsyncService";
import { InfraService } from "../../services/infraService";
import type { ConfigService } from "../../services/configService";
import type { CacheService } from "../../services/cacheService";
import { Glob } from "bun";
import * as path from "path";

export interface AppSyncApiContext {
  configService: ConfigService;
  cacheService: CacheService;
}

// Cache keys
const CACHE_KEY_APPSYNC_SCHEMA = "appsync-schema";
const CACHE_KEY_COGNITO_SELECTION = "appsync-cognito-selection";
const CACHE_KEY_USER_POOLS = "appsync-user-pools";

interface CognitoSelection {
  userPoolId: string;
  userPoolName: string;
  clientId: string;
  clientName: string;
  region: string;
}

export function appsyncRoutes(ctx: AppSyncApiContext) {
  const appSyncService = new AppSyncService();
  const infraService = new InfraService();
  const cognitoService = new CognitoService(undefined, "us-east-2");

  // Helper to get the selected Cognito config (from cache or yaml config)
  async function getCognitoSelection(): Promise<CognitoSelection | null> {
    // First check cache (user selection takes precedence)
    const cached = ctx.cacheService.get<CognitoSelection>(CACHE_KEY_COGNITO_SELECTION);
    if (cached && !ctx.cacheService.isExpired(CACHE_KEY_COGNITO_SELECTION)) {
      return cached.data;
    }

    // Fall back to yaml config
    const stage = await ctx.configService.getInfraStage();
    const envConfig = await ctx.configService.getCassadolEnvironmentConfig(stage);
    const region = await ctx.configService.getCassadolRegion();

    if (envConfig?.cognitoUserPoolId && envConfig?.cognitoClientId) {
      return {
        userPoolId: envConfig.cognitoUserPoolId,
        userPoolName: "From config",
        clientId: envConfig.cognitoClientId,
        clientName: "From config",
        region,
      };
    }

    return null;
  }

  // Helper to find schema files in given paths
  async function findSchemaFiles(searchPaths: string[]): Promise<string[]> {
    const schemaFiles: string[] = [];
    const patterns = ["**/schema.graphql", "**/schema.gql"];

    for (const searchPath of searchPaths) {
      for (const pattern of patterns) {
        const glob = new Glob(pattern);
        try {
          for await (const file of glob.scan({
            cwd: searchPath,
            absolute: true,
            onlyFiles: true,
          })) {
            // Skip node_modules and common build directories
            if (!file.includes("node_modules") && !file.includes("/dist/") && !file.includes("/build/")) {
              schemaFiles.push(file);
            }
          }
        } catch {
          // Ignore errors for paths that don't exist
        }
      }
    }

    // Remove duplicates and sort by relevance (prefer infrastructure folder)
    const unique = [...new Set(schemaFiles)];
    return unique.sort((a, b) => {
      const aInfra = a.includes("infrastructure") ? 0 : 1;
      const bInfra = b.includes("infrastructure") ? 0 : 1;
      if (aInfra !== bInfra) return aInfra - bInfra;
      return a.localeCompare(b);
    });
  }

  // Known infrastructure paths to search for schemas
  const INFRA_PATHS = [
    "/home/djtouchette/work/cassadol/infrastructure",
    "/home/djtouchette/work/cassadol",
  ];

  return {
    // GET /api/appsync/config - Get AppSync configuration status
    "/api/appsync/config": {
      GET: async () => {
        try {
          const cassadolConfig = await ctx.configService.getCassadolConfig();
          const currentEnv = await ctx.configService.getCurrentEnvironment();
          const stage = await ctx.configService.getInfraStage();
          const cognitoSelection = await getCognitoSelection();

          // Get AppSync URL for current environment
          let appSyncUrl = null;
          if (currentEnv) {
            appSyncUrl = await infraService.getAppSyncUrl(currentEnv);
          }

          // Try to auto-detect schema from selected repo and known infrastructure paths
          let detectedSchemaPath = cassadolConfig?.schemaPath || null;
          let availableSchemas: string[] = [];
          const selectedRepo = ctx.cacheService.getSelectedRepo();

          // Build list of paths to search
          const searchPaths = [...INFRA_PATHS];
          if (selectedRepo?.path) {
            searchPaths.unshift(selectedRepo.path);
          }

          availableSchemas = await findSchemaFiles(searchPaths);
          if (!detectedSchemaPath && availableSchemas.length > 0) {
            detectedSchemaPath = availableSchemas[0];
          }

          return Response.json({
            configured: !!(detectedSchemaPath && cognitoSelection),
            schemaPath: detectedSchemaPath,
            availableSchemas,
            region: cassadolConfig?.region || "ca-central-1",
            currentEnvironment: currentEnv,
            stage,
            appSyncUrl,
            cognitoSelection,
            repoPath: selectedRepo?.path || null,
          });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
      PUT: async (req: Request) => {
        try {
          const body = (await req.json()) as {
            schemaPath?: string;
            region?: string;
          };

          if (body.schemaPath || body.region) {
            await ctx.configService.setCassadolConfig({
              schemaPath: body.schemaPath,
              region: body.region,
            });
          }

          // Invalidate cached schema if schema path changed
          if (body.schemaPath) {
            ctx.cacheService.invalidate(CACHE_KEY_APPSYNC_SCHEMA);
            appSyncService.invalidateCache();
          }

          return Response.json({ success: true });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/appsync/cognito/pools - List available Cognito User Pools
    "/api/appsync/cognito/pools": {
      GET: async (req: Request) => {
        try {
          const url = new URL(req.url);
          const forceRefresh = url.searchParams.get("refresh") === "true";

          // Check cache first (unless force refresh)
          if (!forceRefresh) {
            const cached = ctx.cacheService.get<any>(CACHE_KEY_USER_POOLS);
            if (cached && !ctx.cacheService.isExpired(CACHE_KEY_USER_POOLS)) {
              return Response.json({ pools: cached.data, cached: true });
            }
          }

          const pools = await cognitoService.listUserPools();

          // Cache for 10 minutes
          ctx.cacheService.set(CACHE_KEY_USER_POOLS, pools, 10);

          return Response.json({ pools, cached: false });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/appsync/cognito/pools/:poolId/clients - List clients for a User Pool
    "/api/appsync/cognito/pools/:poolId/clients": {
      GET: async (req: Request & { params: { poolId: string } }) => {
        try {
          const poolId = decodeURIComponent(req.params.poolId);
          const clients = await cognitoService.listUserPoolClients(poolId);

          return Response.json({ clients });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // POST/DELETE /api/appsync/cognito/select - Select or clear a User Pool and Client
    "/api/appsync/cognito/select": {
      POST: async (req: Request) => {
        try {
          const body = (await req.json()) as {
            userPoolId: string;
            userPoolName: string;
            clientId: string;
            clientName: string;
            region?: string;
          };

          if (!body.userPoolId || !body.clientId) {
            return Response.json({ error: "User Pool ID and Client ID are required" }, { status: 400 });
          }

          // Use provided region, or default to us-east-2 (where Cognito pools are)
          const region = body.region || "us-east-2";

          const selection: CognitoSelection = {
            userPoolId: body.userPoolId,
            userPoolName: body.userPoolName,
            clientId: body.clientId,
            clientName: body.clientName,
            region,
          };

          // Store in cache (persists for the session, 24 hours)
          ctx.cacheService.set(CACHE_KEY_COGNITO_SELECTION, selection, 60 * 24);

          return Response.json({ success: true, selection });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
      DELETE: async () => {
        try {
          ctx.cacheService.invalidate(CACHE_KEY_COGNITO_SELECTION);
          return Response.json({ success: true });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // GET /api/appsync/schema - Get parsed GraphQL schema
    "/api/appsync/schema": {
      GET: async () => {
        try {
          // Check cache first
          const cached = ctx.cacheService.get<any>(CACHE_KEY_APPSYNC_SCHEMA);
          if (cached && !ctx.cacheService.isExpired(CACHE_KEY_APPSYNC_SCHEMA)) {
            return Response.json({ schema: cached.data, cached: true });
          }

          // Get schema path from config or auto-detect
          let schemaPath = await ctx.configService.getCassadolSchemaPath();

          if (!schemaPath) {
            const selectedRepo = ctx.cacheService.getSelectedRepo();
            const searchPaths = [...INFRA_PATHS];
            if (selectedRepo?.path) {
              searchPaths.unshift(selectedRepo.path);
            }
            const schemas = await findSchemaFiles(searchPaths);
            if (schemas.length > 0) {
              schemaPath = schemas[0];
            }
          }

          if (!schemaPath) {
            return Response.json(
              { error: "No schema found. Select a repository with a GraphQL schema or configure schemaPath." },
              { status: 400 }
            );
          }

          appSyncService.setSchemaPath(schemaPath);
          const schema = await appSyncService.parseSchema();

          // Cache for 60 minutes (schema rarely changes)
          ctx.cacheService.set(CACHE_KEY_APPSYNC_SCHEMA, schema, 60);

          return Response.json({
            schema,
            cached: false,
            schemaPath,
          });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // POST /api/appsync/schema/invalidate - Invalidate schema cache
    "/api/appsync/schema/invalidate": {
      POST: async () => {
        try {
          ctx.cacheService.invalidate(CACHE_KEY_APPSYNC_SCHEMA);
          appSyncService.invalidateCache();
          return Response.json({ success: true });
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // POST /api/appsync/execute - Execute a GraphQL query
    "/api/appsync/execute": {
      POST: async (req: Request) => {
        try {
          const body = (await req.json()) as {
            query: string;
            variables?: Record<string, any>;
            accessToken: string;
          };

          if (!body.query) {
            return Response.json({ error: "Query is required" }, { status: 400 });
          }

          if (!body.accessToken) {
            return Response.json({ error: "Access token is required" }, { status: 401 });
          }

          // Get AppSync URL for current environment
          const currentEnv = await ctx.configService.getCurrentEnvironment();
          if (!currentEnv) {
            return Response.json({ error: "No environment selected" }, { status: 400 });
          }

          const appSyncUrl = await infraService.getAppSyncUrl(currentEnv);
          if (!appSyncUrl) {
            return Response.json(
              { error: `Could not find AppSync URL for environment: ${currentEnv}` },
              { status: 400 }
            );
          }

          const result = await appSyncService.executeQuery(
            appSyncUrl,
            body.query,
            body.variables || null,
            body.accessToken
          );

          return Response.json(result);
        } catch (error) {
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // POST /api/appsync/auth/login - Login with Cognito
    "/api/appsync/auth/login": {
      POST: async (req: Request) => {
        try {
          const body = (await req.json()) as {
            email: string;
            password: string;
          };

          if (!body.email || !body.password) {
            return Response.json({ error: "Email and password are required" }, { status: 400 });
          }

          const cognitoSelection = await getCognitoSelection();

          if (!cognitoSelection) {
            return Response.json(
              { error: "No Cognito User Pool selected. Please select a User Pool and Client first." },
              { status: 400 }
            );
          }

          const authService = new CognitoService({
            region: cognitoSelection.region,
            userPoolId: cognitoSelection.userPoolId,
            clientId: cognitoSelection.clientId,
          });

          const tokens = await authService.login(body.email, body.password);

          return Response.json({
            accessToken: tokens.accessToken,
            idToken: tokens.idToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn,
          });
        } catch (error: any) {
          // Handle Cognito-specific errors
          if (error.name === "NotAuthorizedException") {
            return Response.json({ error: "Invalid email or password" }, { status: 401 });
          }
          if (error.name === "UserNotFoundException") {
            return Response.json({ error: "User not found" }, { status: 401 });
          }
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // POST /api/appsync/auth/refresh - Refresh access token
    "/api/appsync/auth/refresh": {
      POST: async (req: Request) => {
        try {
          const body = (await req.json()) as {
            refreshToken: string;
          };

          if (!body.refreshToken) {
            return Response.json({ error: "Refresh token is required" }, { status: 400 });
          }

          const cognitoSelection = await getCognitoSelection();

          if (!cognitoSelection) {
            return Response.json(
              { error: "No Cognito User Pool selected" },
              { status: 400 }
            );
          }

          const authService = new CognitoService({
            region: cognitoSelection.region,
            userPoolId: cognitoSelection.userPoolId,
            clientId: cognitoSelection.clientId,
          });

          const tokens = await authService.refreshTokens(body.refreshToken);

          return Response.json({
            accessToken: tokens.accessToken,
            idToken: tokens.idToken,
            refreshToken: tokens.refreshToken,
            expiresIn: tokens.expiresIn,
          });
        } catch (error: any) {
          if (error.name === "NotAuthorizedException") {
            return Response.json({ error: "Refresh token expired or invalid" }, { status: 401 });
          }
          return Response.json({ error: String(error) }, { status: 500 });
        }
      },
    },

    // POST /api/appsync/auth/logout - Logout (client-side token clear)
    "/api/appsync/auth/logout": {
      POST: async () => {
        // Server-side logout is a no-op - client clears tokens
        return Response.json({ success: true });
      },
    },
  };
}
