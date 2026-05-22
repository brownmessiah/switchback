/**
 * MSG91 OTP provider. We delegate OTP generation, delivery, and
 * verification to MSG91 — better-auth's phoneNumber plugin uses these
 * helpers via its `sendOTP` and `verifyOTP` hooks.
 *
 * API surface used:
 *   POST https://control.msg91.com/api/v5/otp           — send
 *   GET  https://control.msg91.com/api/v5/otp/verify    — verify
 *
 * The authkey is passed in the `authkey` header; per MSG91 the mobile
 * number is sent without the leading `+` (country code prefixed).
 *
 * All failure paths fail-closed (caller sees `false` / `success: false`)
 * so a flaky MSG91 never lets an unverified Customer through.
 */

export interface Msg91Config {
  authKey: string
  senderId: string
  templateId: string
}

export type SendOtpResult =
  | { success: true; requestId: string }
  | { success: false; reason: 'rate_limited' | 'upstream_error' | 'invalid_response' | 'network_error' }

const SEND_URL = 'https://control.msg91.com/api/v5/otp'
const VERIFY_URL = 'https://control.msg91.com/api/v5/otp/verify'

function normalizePhone(phoneNumber: string): string {
  return phoneNumber.startsWith('+') ? phoneNumber.slice(1) : phoneNumber
}

export async function sendOtpViaMsg91(
  config: Msg91Config,
  phoneNumber: string,
): Promise<SendOtpResult> {
  const mobile = normalizePhone(phoneNumber)
  let response: Response
  try {
    response = await fetch(SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authkey: config.authKey,
      },
      body: JSON.stringify({
        mobile,
        sender: config.senderId,
        template_id: config.templateId,
      }),
    })
  } catch {
    return { success: false, reason: 'network_error' }
  }

  if (response.status === 429) return { success: false, reason: 'rate_limited' }
  if (response.status >= 500) return { success: false, reason: 'upstream_error' }
  if (!response.ok) return { success: false, reason: 'upstream_error' }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return { success: false, reason: 'invalid_response' }
  }

  if (
    payload !== null &&
    typeof payload === 'object' &&
    (payload as { type?: string }).type === 'success' &&
    typeof (payload as { request_id?: unknown }).request_id === 'string'
  ) {
    return {
      success: true,
      requestId: (payload as { request_id: string }).request_id,
    }
  }

  return { success: false, reason: 'invalid_response' }
}

export async function verifyOtpViaMsg91(
  config: Msg91Config,
  phoneNumber: string,
  code: string,
): Promise<boolean> {
  const mobile = normalizePhone(phoneNumber)
  const url = `${VERIFY_URL}?otp=${encodeURIComponent(code)}&mobile=${encodeURIComponent(mobile)}`

  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { authkey: config.authKey },
    })
  } catch {
    return false
  }

  if (!response.ok) return false

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    return false
  }

  return (
    payload !== null &&
    typeof payload === 'object' &&
    (payload as { type?: string }).type === 'success'
  )
}
