// =============================================================================
// @migrare/github — LocalAuthProvider
//
// Reads a GitHub Personal Access Token from the environment.
// Zero OAuth, zero browser, zero friction — the preferred path for:
//   - CLI users who already have a GITHUB_TOKEN
//   - CI/CD pipelines (GitHub Actions, etc.)
//   - Developers running migrare in scripts
//
// TOKEN PRIORITY: explicit ctx.token > MIGRARE_TOKEN env > GITHUB_TOKEN env
//
// SCOPE DETECTION: On authenticate(), the token is validated against the
// GitHub API and the granted scopes are read from the X-OAuth-Scopes header.
// Capabilities are then derived from actual granted scopes, not assumed.
//
// REVOCATION: PATs cannot be revoked programmatically without OAuth.
// revoke() logs a reminder to visit github.com/settings/tokens.
// Reads GITHUB_TOKEN (or MIGRARE_TOKEN) from environment.
// Zero browser, zero OAuth, zero friction for developers.
// Used by CLI runtime and CI pipelines.
// =============================================================================

import type {
  IAuthProvider,
  AuthProviderMeta,
  AuthCapabilities,
  AuthContext,
  AuthSession,
  AuthRedirect,
} from "../types/index.js";
import { generateId } from "../../core/utils/index.js";

export class LocalAuthProvider implements IAuthProvider {
  readonly meta: AuthProviderMeta = {
    id: "local",
    kind: "token",
    name: "Local Token",
    description: "Reads GITHUB_TOKEN from environment — no OAuth required",
  };

  // Conservative capabilities — we don't know what scopes the PAT has
  // resolveCapabilities() will check actual token scopes after auth
  readonly capabilities: AuthCapabilities = {
    canReadRepos: true,
    canReadPrivateRepos: true,
    canWriteBranches: true,
    canOpenPullRequests: true,
    canReadWriteIssues: true,
    canAccessOrgRepos: true,
    canInstallOnOrgs: false,
  };

  async authenticate(ctx: AuthContext): Promise<AuthSession> {
    // Priority: explicit token in ctx > MIGRARE_TOKEN > GITHUB_TOKEN
    const token =
      ctx.token ??
      process.env["MIGRARE_TOKEN"] ??
      process.env["GITHUB_TOKEN"];

    if (!token) {
      throw new Error(
        `[local-auth] No token found.\n` +
        `  Set GITHUB_TOKEN in your environment:\n` +
        `    export GITHUB_TOKEN=ghp_...\n` +
        `  Or generate one at: github.com/settings/tokens`
      );
    }

    // Validate the token and resolve user + scopes via GitHub API
    const { user, scopes } = await this.validateToken(token);

    console.log(`[migrare] Authenticated as ${user.login} (local token)`);

    return {
      id: generateId(16),
      providerId: "local",
      createdAt: new Date(),
      expiresAt: undefined,   // PATs don't expire unless configured
      user,
      token,
      scopes,
      meta: { source: ctx.token ? "explicit" : process.env["MIGRARE_TOKEN"] ? "MIGRARE_TOKEN" : "GITHUB_TOKEN" },
    };
  }

  async refresh(session: AuthSession): Promise<AuthSession> {
    // PATs don't refresh — just re-validate
    return this.authenticate({ runtime: "cli", token: session.token });
  }

  async revoke(_session: AuthSession): Promise<void> {
    // Can't revoke a PAT programmatically without OAuth
    console.info(`[local-auth] To revoke: github.com/settings/tokens`);
  }

  resolveCapabilities(session: AuthSession): AuthCapabilities {
    const scopes = session.scopes;
    const hasRepo = scopes.includes("repo");
    const hasPublicRepo = scopes.includes("public_repo");

    return {
      canReadRepos: hasRepo || hasPublicRepo,
      canReadPrivateRepos: hasRepo,
      canWriteBranches: hasRepo,
      canOpenPullRequests: hasRepo,
      canReadWriteIssues: hasRepo || scopes.includes("issues"),
      canAccessOrgRepos: hasRepo || scopes.includes("read:org"),
      canInstallOnOrgs: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private async validateToken(token: string): Promise<{
    user: AuthSession["user"];
    scopes: string[];
  }> {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (res.status === 401) {
      throw new Error(`[local-auth] Token is invalid or expired`);
    }
    if (!res.ok) {
      throw new Error(`[local-auth] GitHub API error: ${res.status}`);
    }

    // GitHub returns granted scopes in the X-OAuth-Scopes header
    const scopeHeader = res.headers.get("x-oauth-scopes") ?? "";
    const scopes = scopeHeader
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const data = await res.json();

    return {
      user: {
        id: String(data.id),
        login: data.login,
        displayName: data.name ?? data.login,
        email: data.email ?? undefined,
        avatarUrl: data.avatar_url,
        type: "user",
      },
      scopes,
    };
  }
}
