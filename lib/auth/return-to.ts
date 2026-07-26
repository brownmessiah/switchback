/**
 * `returnTo` sanitizer (launch-readiness 02) — the single guard against
 * the open-redirect / phishing risk that a post-auth destination
 * parameter introduces.
 *
 * `returnTo` arrives from a query string and is replayed to a
 * client-callable Server Action, so it is attacker-controllable in both
 * hops. The contract: return a safe same-origin relative path, or null.
 * Callers treat null as "fall back to role-based routing" — a hostile
 * value degrades silently, never errors.
 *
 * Pure module — no 'use server'. Import it into action files; never
 * re-export from one (a 'use server' module may export only async
 * functions).
 */

/** Hygiene cap — no legitimate in-app path approaches this. */
const MAX_LENGTH = 2048

export function sanitizeReturnTo(raw: unknown): string | null {
  if (typeof raw !== 'string') return null

  const value = raw.trim()
  if (value.length === 0 || value.length > MAX_LENGTH) return null

  // Same-origin relative paths only: a single leading slash. Rejects
  // absolute URLs and bare scheme forms (no leading slash), and the
  // protocol-relative `//host` form browsers resolve cross-origin.
  if (!value.startsWith('/')) return null
  if (value.startsWith('//')) return null

  // Backslash variants: browsers normalise `\` to `/` when resolving,
  // so `/\evil.com` behaves as `//evil.com`. Reject anywhere.
  if (value.includes('\\')) return null

  // Control characters (CR/LF header injection, NUL) and raw interior
  // whitespace — legitimate paths carry these percent-encoded.
  if (/[\u0000-\u001f\u007f ]/.test(value)) return null

  // Encoded separators: a downstream decode of %2f / %5c would
  // resurrect the slash/backslash forms rejected above.
  const lower = value.toLowerCase()
  if (lower.includes('%2f') || lower.includes('%5c')) return null

  // Path traversal, raw or percent-encoded in any mix.
  if (value.includes('..')) return null
  if (lower.includes('%2e%2e') || lower.includes('.%2e') || lower.includes('%2e.')) {
    return null
  }

  return value
}
