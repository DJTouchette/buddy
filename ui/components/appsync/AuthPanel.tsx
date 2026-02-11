import React, { useState } from "react";
import { LogIn, LogOut, User, AlertCircle, Loader2 } from "lucide-react";

interface AuthPanelProps {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  currentEnvironment: string | null;
  stage: string;
  onLogin: (email: string, password: string) => Promise<boolean>;
  onLogout: () => void;
}

export function AuthPanel({
  isAuthenticated,
  isLoading,
  error,
  currentEnvironment,
  stage,
  onLogin,
  onLogout,
}: AuthPanelProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    if (!email || !password) {
      setLoginError("Email and password are required");
      return;
    }

    const success = await onLogin(email, password);
    if (success) {
      setEmail("");
      setPassword("");
    }
  };

  if (isAuthenticated) {
    return (
      <div className="appsync-auth-panel appsync-auth-panel-authenticated">
        <div className="appsync-auth-status">
          <User className="w-4 h-4" />
          <span>Authenticated</span>
          <span className="badge badge-green badge-sm">{stage}</span>
          {currentEnvironment && (
            <span className="badge badge-blue badge-sm">{currentEnvironment}</span>
          )}
        </div>
        <button onClick={onLogout} className="btn-secondary appsync-logout-btn">
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    );
  }

  return (
    <div className="appsync-auth-panel">
      <div className="appsync-auth-header">
        <LogIn className="w-5 h-5" />
        <span>Sign in to AppSync</span>
        {currentEnvironment && (
          <span className="badge badge-blue badge-sm">{currentEnvironment}</span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="appsync-auth-form">
        <div className="appsync-form-group">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            disabled={isLoading}
            autoComplete="email"
          />
        </div>

        <div className="appsync-form-group">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            disabled={isLoading}
            autoComplete="current-password"
          />
        </div>

        {(error || loginError) && (
          <div className="appsync-auth-error">
            <AlertCircle className="w-4 h-4" />
            {error || loginError}
          </div>
        )}

        <button type="submit" className="btn-primary" disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Signing in...
            </>
          ) : (
            <>
              <LogIn className="w-4 h-4" />
              Sign In
            </>
          )}
        </button>
      </form>
    </div>
  );
}
