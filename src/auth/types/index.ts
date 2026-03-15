// =============================================================================
// migrare — auth type system
// IAuthProvider is a first-class extension point, same as IPlugin.
// Auth providers are registered with the engine and resolved at session start.
// The AuthSession is opaque to the core — adapters extract what they need.
// =============================================================================

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export type AuthProviderId = "github-oauth" | "github-app" | "gitlab" | "local" | string;

export type AuthProviderKind =
  | "oauth-pkce"      // browser-safe, no server secret (GitHub OAuth + PKCE)
  | "oauth-server"    // requires server-side secret exchange
  | "github-app"      // GitHub App installation tokens
  | "token"           // static token from env (CLI/local)
  | "anonymous";      // read-only, public repos only

// ---------------------------------------------------------------------------
// Capabilities — what a given auth session can do
// Drives UI gating and adapter precondition checks
// ---------------------------------------------------------------------------

export interface AuthCapabilities {
  canReadRepos: boolean;
  canReadPrivateRepos: boolean;
  canWriteBranches: boolean;
  canOpenPullRequests: boolean;
  canReadWriteIssues: boolean;
  canAccessOrgRepos: boolean;
  canInstallOnOrgs: boolean;   // GitHub App only
}

// ---------------------------------------------------------------------------
// AuthSession — opaque to core, used by adapters
// Lives in memory only — never persisted, never sent to migrare.dev
// ---------------------------------------------------------------------------

export interface AuthSession {
  readonly id: string;                    // ephemeral session id
  readonly providerId: AuthProviderId;
  readonly createdAt: Date;
  readonly expiresAt?: Date;

  // Identity — resolved after auth
  readonly user: AuthUser;

  // The token itself — adapters use this directly
  // Opaque string: could be OAuth access token, GitHub App installation token, PAT
  readonly token: string;

  // Scopes granted — used to validate capabilities at runtime
  readonly scopes: string[];

  // For GitHub App installations — which installation this session belongs to
  readonly installationId?: number;

  // Provider-specific metadata
  readonly meta: Record<string, unknown>;
}

export interface AuthUser {
  readonly id: string;
  readonly login: string;            // GitHub username / GitLab handle
  readonly displayName?: string;
  readonly email?: string;
  readonly avatarUrl?: string;
  readonly type: "user" | "org";
}

// ---------------------------------------------------------------------------
// AuthContext — passed to authenticate(), carries runtime info
// ---------------------------------------------------------------------------

export interface AuthContext {
  // For browser: the current URL (for redirect handling)
  currentUrl?: string;

  // For PKCE: the code + state from the OAuth callback
  oauthCode?: string;
  oauthState?: string;

  // For local/token: the token value
  token?: string;

  // For GitHub App: the installation id
  installationId?: number;

  // Runtime environment
  runtime: "browser" | "cli" | "server";
}

// ---------------------------------------------------------------------------
// IAuthProvider — the contract every auth provider implements
// ---------------------------------------------------------------------------

export interface AuthProviderMeta {
  id: AuthProviderId;
  kind: AuthProviderKind;
  name: string;
  description: string;
  // URL to begin the OAuth flow — null for token/local providers
  authorizationUrl?: string;
}

export interface IAuthProvider {
  readonly meta: AuthProviderMeta;
  readonly capabilities: AuthCapabilities;

  /**
   * Begin or complete authentication.
   * - PKCE/OAuth: first call returns { redirectUrl }, second call (with code) returns full session
   * - Token: resolves immediately with session
   * - GitHub App: resolves with installation token
   */
  authenticate(ctx: AuthContext): Promise<AuthSession | AuthRedirect>;

  /**
   * Validate and optionally refresh an existing session.
   * Returns a new session if the token was refreshed, same session if still valid.
   */
  refresh(session: AuthSession): Promise<AuthSession>;

  /**
   * Revoke the session — best effort, never throws.
   * Called on logout or after migration completes.
   */
  revoke(session: AuthSession): Promise<void>;

  /**
   * Resolve capabilities for this session.
   * May differ from static capabilities — e.g. if fewer scopes were granted.
   */
  resolveCapabilities(session: AuthSession): AuthCapabilities;
}

// Returned by authenticate() when a redirect is needed (PKCE step 1)
export interface AuthRedirect {
  readonly redirectUrl: string;
  readonly state: string;     // PKCE state to verify on callback
  readonly codeVerifier: string; // PKCE verifier to store temporarily
}

export function isAuthRedirect(v: AuthSession | AuthRedirect): v is AuthRedirect {
  return "redirectUrl" in v;
}

// ---------------------------------------------------------------------------
// AuthRegistry — manages registered providers, resolves the active session
// ---------------------------------------------------------------------------

export interface IAuthRegistry {
  register(provider: IAuthProvider): void;
  get(id: AuthProviderId): IAuthProvider | undefined;
  list(): IAuthProvider[];

  // Resolve the best available provider for the current runtime
  resolve(runtime: "browser" | "cli" | "server"): IAuthProvider | undefined;

  // Active session — set after successful authentication
  session: AuthSession | null;
  setSession(session: AuthSession): void;
  clearSession(): void;
}

// ---------------------------------------------------------------------------
// GitHub-specific types (used by GitHubOAuthProvider + GitHubAppProvider)
// ---------------------------------------------------------------------------

export interface GitHubOAuthConfig {
  clientId: string;
  // clientSecret is NEVER present in browser builds
  // For PKCE flow, it's not needed at all
  clientSecret?: string;          // CLI/server only
  redirectUri: string;
  scopes: GitHubScope[];
}

export type GitHubScope =
  | "repo"            // full repo access (read + write)
  | "public_repo"     // public repos only
  | "read:org"        // read org membership
  | "write:org"       // write org membership (GitHub App installs)
  | "issues"          // read/write issues
  | "pull_request";   // not a real scope — covered by repo

export interface GitHubAppConfig {
  appId: number;
  appSlug: string;
  // privateKey is SERVER-ONLY — never in browser
  privateKey?: string;
  installationId?: number;
}

// The minimum token payload migrare needs to function
export interface ResolvedGitHubToken {
  token: string;
  type: "oauth" | "app-installation" | "pat";
  scopes: string[];
  expiresAt?: Date;
}
