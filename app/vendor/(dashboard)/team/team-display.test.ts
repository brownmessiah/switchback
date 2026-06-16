import { describe, expect, it } from 'vitest'

import type { AssignableRole } from './team-core'
import {
  ASSIGNABLE_ROLE_OPTIONS,
  formatLastActive,
  roleBadgeVariant,
  roleLabelKey,
  statusBadgeVariant,
} from './team-display'

/**
 * Pure display helpers for the Team & Roles UI (issue #05). These map a
 * member's role/status to a translation key + a Badge variant, and format a
 * nullable `lastActiveAt`. Unit-tested first (TDD) so the role→colour and
 * status→colour contract is asserted before the UI consumes it.
 */

describe('ASSIGNABLE_ROLE_OPTIONS', () => {
  it('offers exactly the four assignable roles (Owner is implicit, never assignable)', () => {
    expect(ASSIGNABLE_ROLE_OPTIONS).toEqual([
      'manager',
      'booking_staff',
      'guide',
      'accountant',
    ])
  })

  it('never includes owner (the DB CHECK + issue-04 schema reject it)', () => {
    expect((ASSIGNABLE_ROLE_OPTIONS as readonly string[]).includes('owner')).toBe(false)
  })
})

describe('roleLabelKey', () => {
  it('maps every assignable role to its VendorTeam translation key', () => {
    const cases: Record<AssignableRole, string> = {
      manager: 'roleManager',
      booking_staff: 'roleBookingStaff',
      guide: 'roleGuide',
      accountant: 'roleAccountant',
    }
    for (const [role, key] of Object.entries(cases)) {
      expect(roleLabelKey(role as AssignableRole)).toBe(key)
    }
  })
})

describe('roleBadgeVariant', () => {
  it('maps each assignable role to a stable, distinct Badge variant', () => {
    expect(roleBadgeVariant('manager')).toBe('info')
    expect(roleBadgeVariant('booking_staff')).toBe('secondary')
    expect(roleBadgeVariant('guide')).toBe('success')
    expect(roleBadgeVariant('accountant')).toBe('credit')
  })
})

describe('statusBadgeVariant', () => {
  it('maps active → success and inactive → outline', () => {
    expect(statusBadgeVariant('active')).toBe('success')
    expect(statusBadgeVariant('inactive')).toBe('outline')
  })
})

describe('formatLastActive', () => {
  it('returns an em dash for a null last-active date', () => {
    expect(formatLastActive(null)).toBe('—')
  })

  it('formats a real date as a short en-IN date (no time)', () => {
    const formatted = formatLastActive(new Date('2026-06-01T10:30:00Z'))
    expect(formatted).not.toBe('—')
    // en-IN short date is "1 Jun 2026"-shaped; assert the year is present and
    // it is not the raw ISO string.
    expect(formatted).toContain('2026')
    expect(formatted).not.toContain('T')
  })
})
