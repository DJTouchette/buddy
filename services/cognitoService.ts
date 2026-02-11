import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  ListUserPoolsCommand,
  ListUserPoolClientsCommand,
  DescribeUserPoolClientCommand,
  type InitiateAuthCommandInput,
  type AuthenticationResultType,
} from "@aws-sdk/client-cognito-identity-provider";

export interface CognitoConfig {
  region: string;
  userPoolId: string;
  clientId: string;
}

export interface AuthTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserPoolInfo {
  id: string;
  name: string;
  creationDate?: Date;
  lastModifiedDate?: Date;
}

export interface UserPoolClientInfo {
  clientId: string;
  clientName: string;
  userPoolId: string;
}

export class CognitoService {
  private client: CognitoIdentityProviderClient;
  private config: CognitoConfig | null;
  private region: string;

  constructor(config?: CognitoConfig, region?: string) {
    this.config = config || null;
    this.region = config?.region || region || "us-east-2";
    this.client = new CognitoIdentityProviderClient({ region: this.region });
  }

  /**
   * List all Cognito User Pools in the region
   */
  async listUserPools(): Promise<UserPoolInfo[]> {
    const pools: UserPoolInfo[] = [];
    let nextToken: string | undefined;

    do {
      const command = new ListUserPoolsCommand({
        MaxResults: 60,
        NextToken: nextToken,
      });

      const response = await this.client.send(command);

      for (const pool of response.UserPools || []) {
        if (pool.Id && pool.Name) {
          pools.push({
            id: pool.Id,
            name: pool.Name,
            creationDate: pool.CreationDate,
            lastModifiedDate: pool.LastModifiedDate,
          });
        }
      }

      nextToken = response.NextToken;
    } while (nextToken);

    return pools.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * List all clients for a specific User Pool
   */
  async listUserPoolClients(userPoolId: string): Promise<UserPoolClientInfo[]> {
    const clients: UserPoolClientInfo[] = [];
    let nextToken: string | undefined;

    do {
      const command = new ListUserPoolClientsCommand({
        UserPoolId: userPoolId,
        MaxResults: 60,
        NextToken: nextToken,
      });

      const response = await this.client.send(command);

      for (const client of response.UserPoolClients || []) {
        if (client.ClientId && client.ClientName) {
          clients.push({
            clientId: client.ClientId,
            clientName: client.ClientName,
            userPoolId,
          });
        }
      }

      nextToken = response.NextToken;
    } while (nextToken);

    return clients.sort((a, b) => a.clientName.localeCompare(b.clientName));
  }

  /**
   * Set the config for authentication
   */
  setConfig(config: CognitoConfig): void {
    this.config = config;
    this.region = config.region;
    this.client = new CognitoIdentityProviderClient({ region: config.region });
  }

  /**
   * Login with email and password using USER_PASSWORD_AUTH flow
   */
  async login(email: string, password: string): Promise<AuthTokens> {
    if (!this.config) {
      throw new Error("Cognito not configured. Select a User Pool and Client first.");
    }

    const params: InitiateAuthCommandInput = {
      AuthFlow: "USER_PASSWORD_AUTH",
      ClientId: this.config.clientId,
      AuthParameters: {
        USERNAME: email,
        PASSWORD: password,
      },
    };

    const command = new InitiateAuthCommand(params);
    const response = await this.client.send(command);

    if (!response.AuthenticationResult) {
      throw new Error("Authentication failed - no result returned");
    }

    return this.mapAuthResult(response.AuthenticationResult);
  }

  /**
   * Refresh tokens using the refresh token
   */
  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    if (!this.config) {
      throw new Error("Cognito not configured");
    }

    const params: InitiateAuthCommandInput = {
      AuthFlow: "REFRESH_TOKEN_AUTH",
      ClientId: this.config.clientId,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
      },
    };

    const command = new InitiateAuthCommand(params);
    const response = await this.client.send(command);

    if (!response.AuthenticationResult) {
      throw new Error("Token refresh failed - no result returned");
    }

    // Refresh flow doesn't return a new refresh token, keep the old one
    const result = this.mapAuthResult(response.AuthenticationResult);
    if (!result.refreshToken) {
      result.refreshToken = refreshToken;
    }

    return result;
  }

  private mapAuthResult(result: AuthenticationResultType): AuthTokens {
    return {
      accessToken: result.AccessToken || "",
      idToken: result.IdToken || "",
      refreshToken: result.RefreshToken || "",
      expiresIn: result.ExpiresIn || 3600,
    };
  }
}
