import { describe, expect, it } from 'vitest'

import { destinationFingerprint } from './payout-destination'

/**
 * The fingerprint is the SHARED join key between a provisioned
 * vendor_fund_accounts row (slice 03) and a Booking's payout destination
 * snapshot (slice 04). It MUST be shape-stable: two logically-equal
 * destinations produce the same fingerprint regardless of key order or
 * undefined-vs-absent differences; distinct destinations differ.
 */
describe('destinationFingerprint', () => {
  it('is deterministic — same input yields the same fingerprint', () => {
    const dest = { vpa: 'vendor@upi' }
    expect(destinationFingerprint(dest)).toBe(destinationFingerprint(dest))
  })

  it('is a 64-char sha256 hex digest', () => {
    const fp = destinationFingerprint({ vpa: 'vendor@upi' })
    expect(fp).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is invariant to key order', () => {
    const a = { accountNumber: '123', ifsc: 'HDFC0001', accountHolderName: 'A' }
    const b = { accountHolderName: 'A', accountNumber: '123', ifsc: 'HDFC0001' }
    expect(destinationFingerprint(a)).toBe(destinationFingerprint(b))
  })

  it('is invariant to key order in nested objects', () => {
    const a = { method: 'bank', detail: { ifsc: 'X', acct: '1' } }
    const b = { detail: { acct: '1', ifsc: 'X' }, method: 'bank' }
    expect(destinationFingerprint(a)).toBe(destinationFingerprint(b))
  })

  it('treats an explicit-undefined value the same as an absent key', () => {
    const a = { vpa: 'vendor@upi' }
    const b = { vpa: 'vendor@upi', email: undefined }
    expect(destinationFingerprint(a)).toBe(destinationFingerprint(b))
  })

  it('produces different fingerprints for different values', () => {
    expect(destinationFingerprint({ vpa: 'a@upi' })).not.toBe(
      destinationFingerprint({ vpa: 'b@upi' }),
    )
  })

  it('produces different fingerprints for different shapes', () => {
    expect(destinationFingerprint({ vpa: 'vendor@upi' })).not.toBe(
      destinationFingerprint({ accountNumber: '123', ifsc: 'HDFC0001', accountHolderName: 'A' }),
    )
  })

  it('distinguishes a string value from a numeric value', () => {
    // Without typing, 123 and "123" would collide under a naive stringify.
    expect(destinationFingerprint({ accountNumber: '123' })).not.toBe(
      destinationFingerprint({ accountNumber: 123 }),
    )
  })

  it('does not confuse key/value boundaries (no delimiter collision)', () => {
    expect(destinationFingerprint({ a: 'b', c: 'd' })).not.toBe(
      destinationFingerprint({ a: 'bcd' }),
    )
  })

  it('handles a null value distinctly from an absent key', () => {
    // Explicit null is a real value; it must differ from the key being absent.
    expect(destinationFingerprint({ note: null })).not.toBe(
      destinationFingerprint({}),
    )
    // And is stable across calls.
    expect(destinationFingerprint({ note: null })).toBe(
      destinationFingerprint({ note: null }),
    )
  })

  it('handles array values order-sensitively', () => {
    expect(destinationFingerprint({ tags: ['a', 'b'] })).toBe(
      destinationFingerprint({ tags: ['a', 'b'] }),
    )
    expect(destinationFingerprint({ tags: ['a', 'b'] })).not.toBe(
      destinationFingerprint({ tags: ['b', 'a'] }),
    )
  })

  it('handles boolean values distinctly from their string forms', () => {
    expect(destinationFingerprint({ primary: true })).not.toBe(
      destinationFingerprint({ primary: 'true' }),
    )
  })

  it('fingerprints a top-level scalar without throwing', () => {
    // Defensive: a malformed destination that is a bare string still hashes.
    expect(destinationFingerprint('raw')).toMatch(/^[0-9a-f]{64}$/)
    expect(destinationFingerprint('raw')).toBe(destinationFingerprint('raw'))
  })
})
