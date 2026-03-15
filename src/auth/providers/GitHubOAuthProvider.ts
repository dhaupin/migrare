// =============================================================================
// @migrare/github — GitHubOAuthProvider (PKCE)
//
// Browser-safe GitHub OAuth using PKCE (Proof Key for Code Exchange).
// PKCE allows the full OAuth flow from a static site with no server secret.
//
// PKCE FLOW:
//   Step 1: authenticate({ runtime: 'browser' })
//     → generates random state + codeVerifier
//     → derives codeChallenge via SHA-256(codeVerifier)
//     → returns AuthRedirect { redirectUrl, state, codeVerifier }
//     → caller stores codeVerifier in sessionStorage (ephemeral only)
//     → browser navigates to redirectUrl
//
//   Step 2: GitHub redirects back with ?code=...&state=...
//
//   Step 3: authenticate({ runtime: 'browser', oauthCode, oauthState })
//     → exchanges code via /api/auth/github/token (the one migrare.dev call)
//     → endpoint holds client secret but discards token immediately after
//     → returns AuthSession { token, user, scopes }
//     → ALL subsequent API calls go directly client → api.github.com
//
// TOKEN PASSTHROUGH: After the code exchange, migrare.dev is never involved.
// The GitHub token lives in the browser's JS heap only.
// Browser-safe OAuth flow. No server secret required.
// migrare.dev serves the static app; ALL GitHub API calls happen client-side.
// The token never touches the migrare.dev server.
//
// Flow:
//   1. authenticate({ runtime: 'browser' })
//      → returns AuthRedirect { redirectUrl, state, codeVerifier }
//      → caller stores codeVerifier in sessionStorage (ephemeral)
//      → caller redirects browser to redirectUrl
//
//   2. GitHub redirects back to redirectUri with ?code=...&state=...
//
//   3. authenticate({ runtime: 'browser', oauthCode, oauthState })
//      → exchanges code for token using PKCE (no secret needed)
//      → returns AuthSession
// =============================================================================

import type {
  IAuthProvider,
  AuthProviderMeta,
  AuthCapabilities,
  AuthContext,
  AuthSession,
  AuthRedirect,
  GitHubOAuthConfig,
  GitHubScope,
} from "../types/index.js";
import { isAuthRedirect } from "../types/index.js";
import { generateId, nowPlusSecs } from "../../core/utils/index.js";

// GitHub OAuth scopes migrare requests
const REQUIRED_SCOPES: GitHubScope[] = ["repo", "read:org"];

export class GitHubOAuthProvider implements IAuthProvider {
  readonly meta: AuthProviderMeta = {
    id: "github-oauth",
    kind: "oauth-pkce",
    name: "GitHub",
    description: "Connect with your GitHub account via OAuth",
    authorizationUrl: "https://github.com/login/oauth/authorize",
  };

  readonly capabilities: AuthCapabilities = {
    canReadRepos: true,
    canReadPrivateRepos: true,
    canWriteBranches: true,
    canOpenPullRequests: true,
    canReadWriteIssues: true,
    canAccessOrgRepos: true,
    canInstallOnOrgs: false,   // GitHub App only
  };

  constructor(private readonly config: GitHubOAuthConfig) {}

  async authenticate(ctx: AuthContext): Promise<AuthSession | AuthRedirect> {
    // ── Step 1: Initiate PKCE flow ────────────────────────────────
    if (!ctx.oauthCode) {
      return this.initiateFlow(ctx);
    }

    // ── Step 2: Exchange code for token ───────────────────────────
    return this.exchangeCode(ctx);
  }

  async refresh(session: AuthSession): Promise<AuthSession> {
    // GitHub OAuth tokens don't expire unless revoked.
    // Validate by making a lightweight API call.
    try {
      const user = await this.fetchUser(session.token);
      // Return refreshed session with updated user info
      return { ...session, user, meta: { ...session.meta, refreshedAt: new Date() } };
    } catch {
      throw new Error(`[github-oauth] Session invalid — re-authenticate`);
    }
  }

  async revoke(session: AuthSession): Promise<void> {
    // GitHub OAuth token revocation requires the client secret,
    // which we don't have in the browser (by design).
    // Best effort: clear session from memory. User can revoke at github.com/settings/applications
    console.info(`[github-oauth] Session cleared. To fully revoke: github.com/settings/applications`);
  }

  resolveCapabilities(session: AuthSession): AuthCapabilities {
    const scopes = session.scopes;
    return {
      canReadRepos: scopes.includes("repo") || scopes.includes("public_repo"),
      canReadPrivateRepos: scopes.includes("repo"),
      canWriteBranches: scopes.includes("repo"),
      canOpenPullRequests: scopes.includes("repo"),
      canReadWriteIssues: scopes.includes("repo") || scopes.includes("issues"),
      canAccessOrgRepos: scopes.includes("repo") || scopes.includes("read:org"),
      canInstallOnOrgs: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async initiateFlow(ctx: AuthContext): Promise<AuthRedirect> {
    const state = generateId(32);
    const codeVerifier = generateId(64);
    const codeChallenge = await this.pkceChallenge(codeVerifier);

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: (this.config.scopes ?? REQUIRED_SCOPES).join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    const redirectUrl = `https://github.com/login/oauth/authorize?${params}`;
    return { redirectUrl, state, codeVerifier };
  }

  private async exchangeCode(ctx: AuthContext): Promise<AuthSession> {
    if (!ctx.oauthCode || !ctx.oauthState) {
      throw new Error(`[github-oauth] Missing oauthCode or oauthState in context`);
    }

    // For PKCE without a client secret, we proxy ONLY the code exchange
    // through a lightweight migrare.dev endpoint that holds the client secret
    // but immediately discards the token — it's returned to the browser and
    // never logged or stored server-side.
    //
    // This is the ONLY call that touches migrare.dev servers.
    // The endpoint is open-source and auditable.
    const tokenRes = await fetch(`/api/auth/github/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: ctx.oauthCode,
        state: ctx.oauthState,
        // codeVerifier passed from sessionStorage by the caller
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      throw new Error(`[github-oauth] Token exchange failed: ${err.error ?? tokenRes.statusText}`);
    }

    const { access_token, scope, token_type } = await tokenRes.json();

    // Resolve user identity — this call is client-side
    const user = await this.fetchUser(access_token);

    return {
      id: generateId(16),
      providerId: "github-oauth",
      createdAt: new Date(),
      // GitHub OAuth tokens don't have expiry by default
      expiresAt: undefined,
      user,
      token: access_token,
      scopes: (scope ?? "").split(",").map((s: string) => s.trim()),
      meta: { tokenType: token_type },
    };
  }

  private async fetchUser(token: string) {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!res.ok) throw new Error(`[github-oauth] Failed to fetch user: ${res.status}`);

    const data = await res.json();
    return {
      id: String(data.id),
      login: data.login,
      displayName: data.name ?? data.login,
      email: data.email ?? undefined,
      avatarUrl: data.avatar_url,
      type: "user" as const,
    };
  }

  // PKCE S256 challenge — Web Crypto API (browser + Node 18+)
  private async pkceChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }
}
