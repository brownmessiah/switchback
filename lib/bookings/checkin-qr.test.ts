import { describe, expect, it } from 'vitest'

import { verifyCheckInToken } from './checkin-token'
import {
  buildCheckInDeepLink,
  checkInExpiryFor,
  shouldShowCheckInQr,
} from './checkin-qr'

/**
 * Pure helpers for the customer-facing check-in QR (issue #06).
 *
 * `shouldShowCheckInQr` — the QR is only meaningful for states where arrival
 * matters (confirmed / awaiting_completion); NOT for cancelled/completed/etc.
 * `checkInExpiryFor` — TTL policy: slot end + a 24h grace window.
 * `buildCheckInDeepLink` — `<origin>/vendor/checkin?token=<signedToken>`, and
 * the round-trip verifies under the same secret.
 */

const SECRET = 'a'.repeat(32)
const BOOKING_ID = '22222222-2222-2222-2222-222222222222'

describe('shouldShowCheckInQr', () => {
  it('shows the QR for confirmed and awaiting_completion', () => {
    expect(shouldShowCheckInQr('confirmed')).toBe(true)
    expect(shouldShowCheckInQr('awaiting_completion')).toBe(true)
  })

  it('hides the QR for terminal / non-arrival states', () => {
    for (const state of [
      'pending_payment',
      'completed',
      'disputed',
      'cancelled_by_customer',
      'cancelled_by_vendor',
      'cancelled_post_experience',
      'no_show',
    ]) {
      expect(shouldShowCheckInQr(state)).toBe(false)
    }
  })
})

describe('checkInExpiryFor', () => {
  it('is the slot end plus a 24h grace window', () => {
    const slotEnd = new Date('2026-07-01T10:00:00.000Z')
    const expiry = checkInExpiryFor(slotEnd)
    expect(expiry).toBe(slotEnd.getTime() + 24 * 60 * 60 * 1000)
  })
})

describe('buildCheckInDeepLink', () => {
  it('builds an <origin>/vendor/checkin?token=… URL that round-trips', () => {
    const slotEnd = new Date(Date.now() + 60_000)
    const url = buildCheckInDeepLink({
      origin: 'https://switchback.com',
      bookingId: BOOKING_ID,
      slotEnd,
      secret: SECRET,
    })

    expect(url.startsWith('https://switchback.com/vendor/checkin?token=')).toBe(true)

    const token = new URL(url).searchParams.get('token')
    expect(token).toBeTruthy()
    const verified = verifyCheckInToken(token!, SECRET, Date.now())
    expect(verified.ok).toBe(true)
    if (verified.ok) expect(verified.bookingId).toBe(BOOKING_ID)
  })

  it('strips a trailing slash on the origin so the path is not doubled', () => {
    const url = buildCheckInDeepLink({
      origin: 'https://switchback.com/',
      bookingId: BOOKING_ID,
      slotEnd: new Date(Date.now() + 60_000),
      secret: SECRET,
    })
    expect(url.startsWith('https://switchback.com/vendor/checkin?token=')).toBe(true)
    expect(url).not.toContain('//vendor')
  })
})
