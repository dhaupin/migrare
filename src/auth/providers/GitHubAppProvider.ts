// =============================================================================
// @migrare/github — GitHubAppProvider
//
// Server-side provider for GitHub App installations.
// Used when an org admin installs the migrare GitHub App, granting access
// to org repos with fine-grained per-repo permissions.
//
// SECURITY: This class requires the GitHub App private key. It MUST NOT be
// instantiated in browser builds — the constructor throws if window is defined.
//
// TOKEN LIFECYCLE: GitHub App installation tokens expire after 1 hour.
// refresh() generates a new one automatically. The engine calls refresh()
// before each migrate() if the session is near expiry.
//
// JWT GENERATION: Uses Web Crypto (RSASSA-PKCS1-v1_5 + SHA-256), which is
// available in Node 18+ and all modern browsers. No external JWT library needed.
// For org installations. Generates short-lived installation tokens.
// Requires the GitHub App private key — SERVER-SIDE ONLY.
// Never instantiated in browser builds.
//
// Used when:
//   - An org admin installs the migrare GitHub App
//   - migrare needs access to org repos without individual OAuth
//   - Fine-grained permissions per-repo are required
// =============================================================================

import type {
  IAuthProvider,
  AuthProviderMeta,
  AuthCapabilities,
  AuthContext,
  AuthSession,
  AuthRedirect,
  GitHubAppConfig,
} from "../types/index.js";
import { generateId, nowPlusSecs } from "../../core/utils/index.js";

export class GitHubAppProvider implements IAuthProvider {
  readonly meta: AuthProviderMeta = {
    id: "github-app",
    kind: "github-app",
    name: "GitHub App",
    description: "Organization-level access via GitHub App installation",
  };

  readonly capabilities: AuthCapabilities = {
    canReadRepos: true,
    canReadPrivateRepos: true,
    canWriteBranches: true,
    canOpenPullRequests: true,
    canReadWriteIssues: true,
    canAccessOrgRepos: true,
    canInstallOnOrgs: true,
  };

  constructor(private readonly config: GitHubAppConfig) {
    if (typeof window !== "undefined") {
      throw new Error(
        `[github-app] GitHubAppProvider must not be instantiated in browser environments. ` +
        `It requires the GitHub App private key which must never be exposed client-side.`
      );
    }
  }

  async authenticate(ctx: AuthContext): Promise<AuthSession | AuthRedirect> {
    const installationId = ctx.installationId ?? this.config.installationId;
    if (!installationId) {
      throw new Error(`[github-app] installationId required in context or config`);
    }

    // Generate a JWT to authenticate as the GitHub App
    const appJwt = await this.generateAppJwt();

    // Exchange for an installation access token (short-lived, 1 hour)
    const tokenRes = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!tokenRes.ok) {
      throw new Error(`[github-app] Failed to get installation token: ${tokenRes.status}`);
    }

    const { token, expires_at, repositories, permissions } = await tokenRes.json();

    // Resolve the installation's owner (org or user)
    const installationRes = await fetch(
      `https://api.github.com/app/installations/${installationId}`,
      {
        headers: {
          Authorization: `Bearer ${appJwt}`,
          Accept: "application/vnd.github+json",
        },
      }
    );
    const installation = installationRes.ok ? await installationRes.json() : {};
    const account = installation.account ?? {};

    return {
      id: generateId(16),
      providerId: "github-app",
      createdAt: new Date(),
      expiresAt: expires_at ? new Date(expires_at) : nowPlusSecs(3600),
      user: {
        id: String(account.id ?? installationId),
        login: account.login ?? `installation-${installationId}`,
        displayName: account.name ?? account.login,
        avatarUrl: account.avatar_url,
        type: account.type === "Organization" ? "org" : "user",
      },
      token,
      scopes: Object.keys(permissions ?? {}),
      installationId,
      meta: {
        appId: this.config.appId,
        repositories: repositories?.map((r: { full_name: string }) => r.full_name) ?? [],
        permissions,
      },
    };
  }

  async refresh(session: AuthSession): Promise<AuthSession> {
    // Installation tokens expire after 1 hour — re-authenticate
    if (session.expiresAt && session.expiresAt < new Date()) {
      if (!session.installationId) {
        throw new Error("Cannot refresh: missing installationId");
      }
      const result = await this.authenticate({ runtime: "server", installationId: session.installationId });
      if ("redirectUrl" in result) {
        throw new Error("Cannot refresh: OAuth redirect not supported for GitHub App");
      }
      return result;
    }
    return session;
  }

  async revoke(_session: AuthSession): Promise<void> {
    // Installation tokens expire automatically — nothing to revoke explicitly
  }

  resolveCapabilities(session: AuthSession): AuthCapabilities {
    const perms = (session.meta.permissions ?? {}) as Record<string, string>;
    return {
      canReadRepos: !!perms.contents,
      canReadPrivateRepos: !!perms.contents,
      canWriteBranches: perms.contents === "write",
      canOpenPullRequests: !!perms.pull_requests,
      canReadWriteIssues: !!perms.issues,
      canAccessOrgRepos: true,
      canInstallOnOrgs: true,
    };
  }

  // ---------------------------------------------------------------------------
  // JWT generation for GitHub App authentication
  // Uses Web Crypto (Node 18+ compatible)
  // ---------------------------------------------------------------------------

  private async generateAppJwt(): Promise<string> {
    if (!this.config.privateKey) {
      throw new Error(`[github-app] privateKey is required for JWT generation`);
    }

    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const payload = {
      iat: now - 60,    // issued 60s ago to handle clock skew
      exp: now + 600,   // expires in 10 minutes
      iss: this.config.appId,
    };

    const encode = (obj: object) =>
      Buffer.from(JSON.stringify(obj)).toString("base64url");

    const headerB64 = encode(header);
    const payloadB64 = encode(payload);
    const signingInput = `${headerB64}.${payloadB64}`;

    // Import the PEM private key
    const pemContents = this.config.privateKey
      .replace(/-----BEGIN RSA PRIVATE KEY-----/, "")
      .replace(/-----END RSA PRIVATE KEY-----/, "")
      .replace(/\s/g, "");

    const keyData = Buffer.from(pemContents, "base64");
    const cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      keyData,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      Buffer.from(signingInput)
    );

    const signatureB64 = Buffer.from(signature).toString("base64url");
    return `${signingInput}.${signatureB64}`;
  }
}
