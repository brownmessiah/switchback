import { describe, expect, it } from 'vitest'

import { shortRef } from './short-ref'

describe('shortRef', () => {
  it('renders a stable OV-<4hex> human ref from a UUID', () => {
    // Last 4 hex of the UUID, uppercased, prefixed OV-.
    expect(shortRef('70382f50-e11f-4a2b-9c3d-aabbccdd3f50')).toBe('OV-3F50')
  })

  it('uppercases lowercase hex tails', () => {
    expect(shortRef('11111111-2222-3333-4444-5555aabbccdd')).toBe('OV-CCDD')
  })

  it('is deterministic for the same id', () => {
    const id = '96b0bbfb-6087-4d3e-8a1f-0011223344ff'
    expect(shortRef(id)).toBe(shortRef(id))
    expect(shortRef(id)).toBe('OV-44FF')
  })

  it('falls back to the last 4 chars of a non-UUID id', () => {
    expect(shortRef('u_seed_admin_42ab')).toBe('OV-42AB')
  })

  it('strips a trailing hyphen group cleanly even with short tails', () => {
    // A short opaque tail (< 4 chars) is padded by using whatever is present.
    expect(shortRef('abc')).toBe('OV-ABC')
  })

  it('returns a neutral placeholder for empty / nullish ids', () => {
    expect(shortRef('')).toBe('OV-—')
    expect(shortRef(null)).toBe('OV-—')
    expect(shortRef(undefined)).toBe('OV-—')
  })

  it('ignores surrounding whitespace', () => {
    expect(shortRef('  70382f50-e11f-4a2b-9c3d-aabbccdd3f50  ')).toBe('OV-3F50')
  })
})
