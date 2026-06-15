import { describe, expect, it } from 'vitest'

import {
  VENDOR_PERMISSIONS,
  VENDOR_ROLES,
  can,
  type VendorPermission,
  type VendorRole,
} from './vendor-permissions'

/**
 * Pure unit tests for the Vendor permission matrix (ADR-0006 rev 2026-06-15).
 *
 * The PRD's five-role matrix is encoded VERBATIM. The explicit DENY cases
 * from the PRD are mandatory assertions — they are the security contract, so
 * each one is asserted individually rather than only via the exhaustive sweep.
 */

describe('Vendor permission matrix (ADR-0006)', () => {
  describe('Owner — full access (wildcard)', () => {
    it('grants every permission in the vocabulary', () => {
      for (const perm of VENDOR_PERMISSIONS) {
        expect(can('owner', perm)).toBe(true)
      }
    })
  })

  describe('Manager — experiences, bookings, availability, analytics', () => {
    it('manages experiences', () => {
      expect(can('manager', 'experiences:manage')).toBe(true)
    })
    it('manages availability', () => {
      expect(can('manager', 'availability:manage')).toBe(true)
    })
    it('reads and manages bookings', () => {
      expect(can('manager', 'bookings:read')).toBe(true)
      expect(can('manager', 'bookings:manage')).toBe(true)
    })
    it('reads analytics', () => {
      expect(can('manager', 'analytics:read')).toBe(true)
    })

    // ── Explicit PRD denies (mandatory) ──
    it('CANNOT close the account', () => {
      expect(can('manager', 'account:close')).toBe(false)
    })
    it('CANNOT edit bank details', () => {
      expect(can('manager', 'bank:manage')).toBe(false)
    })
    it('CANNOT manage the team', () => {
      expect(can('manager', 'team:manage')).toBe(false)
    })
  })

  describe('Booking Staff — bookings + QR check-in only', () => {
    it('reads and manages bookings', () => {
      expect(can('booking_staff', 'bookings:read')).toBe(true)
      expect(can('booking_staff', 'bookings:manage')).toBe(true)
    })
    it('marks check-in (scan QR / check-in / completed)', () => {
      expect(can('booking_staff', 'bookings:checkin')).toBe(true)
    })

    // ── Explicit PRD denies (mandatory): not pricing, payouts, KYC, or team ──
    it('CANNOT manage pricing (experiences)', () => {
      expect(can('booking_staff', 'experiences:manage')).toBe(false)
    })
    it('CANNOT read payouts', () => {
      expect(can('booking_staff', 'payouts:read')).toBe(false)
    })
    it('CANNOT manage KYC / business details', () => {
      expect(can('booking_staff', 'kyc:manage')).toBe(false)
    })
    it('CANNOT manage the team', () => {
      expect(can('booking_staff', 'team:manage')).toBe(false)
    })
    it('CANNOT edit bank details', () => {
      expect(can('booking_staff', 'bank:manage')).toBe(false)
    })
  })

  describe('Guide — assigned bookings + arrived/completed only, no money', () => {
    it('reads bookings (assigned)', () => {
      expect(can('guide', 'bookings:read')).toBe(true)
    })
    it('marks customers arrived/completed (check-in)', () => {
      expect(can('guide', 'bookings:checkin')).toBe(true)
    })

    // ── Explicit PRD denies (mandatory): not earnings, payouts, bank, KYC, team ──
    it('CANNOT read earnings/analytics', () => {
      expect(can('guide', 'analytics:read')).toBe(false)
    })
    it('CANNOT read payouts', () => {
      expect(can('guide', 'payouts:read')).toBe(false)
    })
    it('CANNOT edit bank details', () => {
      expect(can('guide', 'bank:manage')).toBe(false)
    })
    it('CANNOT manage KYC', () => {
      expect(can('guide', 'kyc:manage')).toBe(false)
    })
    it('CANNOT manage the team', () => {
      expect(can('guide', 'team:manage')).toBe(false)
    })
    it('CANNOT manage experiences', () => {
      expect(can('guide', 'experiences:manage')).toBe(false)
    })
    it('does NOT get full booking management (assigned-only is read+checkin)', () => {
      // Guide can mark arrived/completed (checkin) but is not a general
      // booking manager (no cancel / no-show authority).
      expect(can('guide', 'bookings:manage')).toBe(false)
    })
  })

  describe('Accountant — money read-only', () => {
    it('reads payouts/earnings/invoices', () => {
      expect(can('accountant', 'payouts:read')).toBe(true)
    })
    it('reads analytics (earnings / booking revenue)', () => {
      expect(can('accountant', 'analytics:read')).toBe(true)
    })
    it('reads bookings (booking revenue)', () => {
      expect(can('accountant', 'bookings:read')).toBe(true)
    })

    // ── Explicit PRD denies (mandatory): not experiences, availability, KYC, team ──
    it('CANNOT edit experiences', () => {
      expect(can('accountant', 'experiences:manage')).toBe(false)
    })
    it('CANNOT edit availability', () => {
      expect(can('accountant', 'availability:manage')).toBe(false)
    })
    it('CANNOT manage KYC', () => {
      expect(can('accountant', 'kyc:manage')).toBe(false)
    })
    it('CANNOT manage the team', () => {
      expect(can('accountant', 'team:manage')).toBe(false)
    })
    it('CANNOT manage bookings (read-only)', () => {
      expect(can('accountant', 'bookings:manage')).toBe(false)
    })
    it('CANNOT edit bank details', () => {
      expect(can('accountant', 'bank:manage')).toBe(false)
    })
    it('CANNOT close the account', () => {
      expect(can('accountant', 'account:close')).toBe(false)
    })
  })

  describe('exhaustiveness — every role × every permission resolves to a boolean', () => {
    it('covers the full matrix', () => {
      for (const role of VENDOR_ROLES) {
        for (const perm of VENDOR_PERMISSIONS) {
          expect(typeof can(role, perm)).toBe('boolean')
        }
      }
    })

    it('owner is the only role holding account:close, bank:manage and team:manage', () => {
      const privileged: VendorPermission[] = ['account:close', 'bank:manage', 'team:manage']
      const nonOwnerRoles: VendorRole[] = ['manager', 'booking_staff', 'guide', 'accountant']
      for (const perm of privileged) {
        expect(can('owner', perm)).toBe(true)
        for (const role of nonOwnerRoles) {
          expect(can(role, perm)).toBe(false)
        }
      }
    })
  })
})
