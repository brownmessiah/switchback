import { APIError } from '@better-auth/core/error'
import { describe, expect, it } from 'vitest'

import type { SendOtpResult } from './msg91-provider'
import { throwIfOtpSendFailed } from './otp-send-error'

/**
 * launch-readiness 03: lib/auth/index.ts's sendOTP hook used to discard
 * the SendOtpResult entirely — a failed MSG91 send still returned 200
 * "code sent", so the sign-in UI advanced to a code-entry step no code
 * was ever sent for. This module maps a failure onto a thrown APIError,
 * so /phone-number/send-otp returns a non-2xx response the client can
 * react to (and MUST NOT advance past the number step for).
 */
describe('throwIfOtpSendFailed', () => {
  it('does not throw on success', () => {
    const success: SendOtpResult = { success: true, requestId: 'req_1' }
    expect(() => throwIfOtpSendFailed(success)).not.toThrow()
  })

  it.each([
    ['rate_limited', 429],
    ['not_configured', 503],
    ['network_error', 503],
    ['upstream_error', 502],
    ['invalid_response', 502],
  ] as const)('throws a mapped APIError for reason=%s (HTTP %i)', (reason, statusCode) => {
    const failure: SendOtpResult = { success: false, reason }

    let caught: unknown
    try {
      throwIfOtpSendFailed(failure)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(APIError)
    const apiError = caught as InstanceType<typeof APIError>
    expect(apiError.statusCode).toBe(statusCode)
    expect(apiError.body?.message).toBeTruthy()
    expect(apiError.body?.code).toMatch(/^OTP_SEND_/)
  })
})
