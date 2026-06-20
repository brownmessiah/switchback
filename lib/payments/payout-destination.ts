import { createHash } from 'node:crypto'

/**
 * Deterministic, shape-stable fingerprint of a Vendor payout destination.
 *
 * This is the SHARED join key between two slices of the Razorpay X payout
 * path (ADR-0016, 2026-06-18 amendment):
 *
 *  - slice 03 (provisioning) fingerprints the destination the Vendor sets and
 *    keys a `vendor_fund_accounts` row on `(vendorUserId, fingerprint)`;
 *  - slice 04 (Payout Batch planner) fingerprints a Booking's
 *    `payoutDestinationSnapshot` with the SAME function to resolve the Fund
 *    Account that was provisioned for the destination that Booking captured.
 *
 * Because the two sides must agree, the fingerprint MUST NOT depend on
 * incidental shape — key order, or an explicit `undefined` value versus an
 * absent key. We canonicalize by recursively sorting object keys, dropping
 * `undefined`-valued keys, and JSON-encoding each scalar (so a numeric `123`
 * never collides with the string `"123"` and key/value boundaries cannot run
 * together), then hash the canonical string with sha256.
 *
 * Pure — no I/O, no clock, no randomness.
 */
export function destinationFingerprint(destination: unknown): string {
  const canonical = canonicalize(destination)
  return createHash('sha256').update(canonical).digest('hex')
}

/**
 * Produce a canonical, collision-resistant string for any JSON-like value.
 * Objects: keys sorted, `undefined` values dropped, rendered as
 * `{"k":<canonical>,...}`. Arrays preserve order. Scalars are JSON-encoded so
 * the quoting distinguishes types and delimits values unambiguously.
 */
function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const parts = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
    return `{${parts.join(',')}}`
  }
  // Scalars (string, number, boolean): JSON-encoded so quoting distinguishes
  // types (123 vs "123") and delimits values unambiguously.
  return JSON.stringify(value)
}
