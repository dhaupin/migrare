// =============================================================================
// @migrare/core — AuthRegistry
//
// Manages registered IAuthProvider instances and the active AuthSession.
//
// SESSION STORAGE: The active session is held in memory only — never written
// to disk, localStorage, or any server. This is a deliberate trust commitment:
// migrare.dev never stores or logs your GitHub token.
//
// PROVIDER RESOLUTION: resolve(runtime) returns the most appropriate provider
// for the current environment:
//   browser → github-oauth (PKCE, no server secret)
//   cli     → local (GITHUB_TOKEN from env), fallback to github-oauth
//   server  → github-app (installation token), fallback to github-oauth
//
// THREAD SAFETY: The registry is not designed for concurrent modification.
// Register all providers at startup, then treat the registry as read-only.
// Manages registered IAuthProvider instances.
// Holds the active AuthSession in memory — never persisted.
// =============================================================================

import type {
  IAuthProvider,
  IAuthRegistry,
  AuthSession,
  AuthProviderId,
} from "./types/index.js";

export class AuthRegistry implements IAuthRegistry {
  private providers = new Map<AuthProviderId, IAuthProvider>();
  private _session: AuthSession | null = null;

  register(provider: IAuthProvider): void {
    if (this.providers.has(provider.meta.id)) {
      console.warn(`[migrare:auth] Provider already registered, overwriting: ${provider.meta.id}`);
    }
    this.providers.set(provider.meta.id, provider);
  }

  get(id: AuthProviderId): IAuthProvider | undefined {
    return this.providers.get(id);
  }

  list(): IAuthProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Resolve the most appropriate provider for the current runtime.
   * Priority:
   *   browser → github-oauth (PKCE)
   *   cli     → local (token from env), fallback to github-oauth
   *   server  → github-app, fallback to github-oauth
   */
  resolve(runtime: "browser" | "cli" | "server"): IAuthProvider | undefined {
    if (runtime === "cli") {
      return this.providers.get("local") ?? this.providers.get("github-oauth");
    }
    if (runtime === "server") {
      return this.providers.get("github-app") ?? this.providers.get("github-oauth");
    }
    // browser
    return this.providers.get("github-oauth");
  }

  get session(): AuthSession | null {
    return this._session;
  }

  setSession(session: AuthSession): void {
    // Validate not expired before setting
    if (session.expiresAt && session.expiresAt < new Date()) {
      throw new Error(`[migrare:auth] Cannot set expired session`);
    }
    this._session = session;
  }

  clearSession(): void {
    this._session = null;
  }

  /**
   * Assert a session is active and not expired.
   * Throws if no session or session expired.
   */
  requireSession(): AuthSession {
    if (!this._session) {
      throw new Error(`[migrare:auth] No active session. Call authenticate() first.`);
    }
    if (this._session.expiresAt && this._session.expiresAt < new Date()) {
      this._session = null;
      throw new Error(`[migrare:auth] Session expired. Re-authenticate.`);
    }
    return this._session;
  }
}
