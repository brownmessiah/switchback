/**
 * Maps an OTP-send failure onto a thrown APIError (launch-readiness 03).
 *
 * Before this module existed, lib/auth/index.ts's `sendOTP` hook called
 * `sendOtpViaMsg91` and discarded the returned `SendOtpResult` entirely.
 * better-auth's `sendPhoneNumberOTP` route always answers `200 "code
 * sent"` unless the `sendOTP` hook itself throws — so a flaky/unconfigured
 * MSG91 silently looked like a successful send, and the sign-in UI
 * advanced to a code-entry step for a code that was never sent.
 *
 * Throwing here surfaces the failure as a non-2xx response the client
 * receives as `res.error`, so the phone panel can stay on the number step
 * instead of advancing on a false "sent".
 */
import { APIError } from '@better-auth/core/error'

import type { SendOtpResult } from './msg91-provider'

type SendOtpFailure = Extract<SendOtpResult, { success: false }>

type MappedStatus = 'TOO_MANY_REQUESTS' | 'SERVICE_UNAVAILABLE' | 'BAD_GATEWAY'

function describeFailure(reason: SendOtpFailure['reason']): {
  status: MappedStatus
  code: string
  message: string
} {
  switch (reason) {
    case 'rate_limited':
      return {
        status: 'TOO_MANY_REQUESTS',
        code: 'OTP_SEND_RATE_LIMITED',
        message: 'Too many attempts. Please wait a moment and try again.',
      }
    case 'not_configured':
      return {
        status: 'SERVICE_UNAVAILABLE',
        code: 'OTP_SEND_NOT_CONFIGURED',
        message: 'Phone sign-in is not available right now.',
      }
    case 'network_error':
      return {
        status: 'SERVICE_UNAVAILABLE',
        code: 'OTP_SEND_NETWORK_ERROR',
        message: 'We could not reach the SMS provider. Please try again.',
      }
    case 'upstream_error':
    case 'invalid_response':
      return {
        status: 'BAD_GATEWAY',
        code: 'OTP_SEND_UPSTREAM_ERROR',
        message: 'We could not send the verification code. Please try again.',
      }
    default: {
      const exhaustive: never = reason
      throw new Error(`Unhandled SendOtpResult reason: ${String(exhaustive)}`)
    }
  }
}

/** Throws iff `result` is a failure — a no-op on success. */
export function throwIfOtpSendFailed(result: SendOtpResult): void {
  if (result.success) return
  const { status, code, message } = describeFailure(result.reason)
  throw APIError.from(status, { code, message })
}
