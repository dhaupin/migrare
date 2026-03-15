// =============================================================================
// @migrare/core — utility functions
//
// Small, dependency-free helpers used across the codebase.
// This file has no imports from migrare — it is safe to import from anywhere.
// All functions are pure and synchronous except `sleep`.
// =============================================================================

/**
 * Generate a cryptographically random hex string of the given byte length.
 * Uses the Web Crypto API (available in Node 18+ and all modern browsers).
 * Used for ephemeral session IDs, PKCE state/verifier generation, etc.
 *
 * @param byteLength Number of random bytes. Output is 2× this length in hex chars.
 */
export function generateId(byteLength: number = 16): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Return a Date that is `seconds` from now.
 * Used for computing token expiry from a TTL value (e.g. GitHub App tokens).
 */
export function nowPlusSecs(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

/**
 * Return a Date that is `ms` milliseconds from now.
 * Used for finer-grained expiry calculations.
 */
export function nowPlusMs(ms: number): Date {
  return new Date(Date.now() + ms);
}

/**
 * Type guard for non-null plain objects (excludes arrays).
 * Used to safely narrow `unknown` values from API responses.
 */
export function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Deep clone a JSON-serialisable object via JSON round-trip.
 * Not suitable for objects with Dates, Maps, Sets, or circular references.
 * Used for snapshotting plain config objects before mutation.
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Pause execution for `ms` milliseconds.
 * Used in tests and retry loops. Prefer event-driven patterns in production code.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Split an array into consecutive batches of `size`.
 * Used by GitHubIngestAdapter to batch GitHub API file-content requests,
 * avoiding rate limit exhaustion on large repositories.
 *
 * @example chunk([1,2,3,4,5], 2) → [[1,2],[3,4],[5]]
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Truncate a string to `maxLen` characters, appending "…" if truncated.
 * Used for safe display of long file paths and error messages in the UI.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}
