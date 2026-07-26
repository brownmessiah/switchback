/**
 * Single source of truth for whether phone / OTP authentication is
 * available (launch-readiness 01).
 *
 * Consulted by BOTH the sign-in UI (whether to offer the phone tab) and
 * the server (whether to accept a verification), so the two can never
 * disagree. Phone auth activates automatically once real MSG91
 * credentials are present — going live is a configuration change, never
 * a code change.
 *
 * All THREE MSG91 variables are required in production: sendOtpViaMsg91
 * posts `{mobile, sender, template_id}`, so an auth key with a blank
 * sender or template id takes the real path and dead-ends — a lit-up
 * phone tab in a half-configured production.
 *
 * Outside production the dev bypass ('000000', no live SMS) makes phone
 * auth available regardless of configuration, for local dev and E2E.
 */

import type { Env } from '@/lib/env'

import { verifyOtpViaMsg91, type Msg91Config } from './msg91-provider'

export type PhoneAuthEnv = Pick<
  Env,
  'NODE_ENV' | 'MSG91_AUTH_KEY' | 'MSG91_SENDER_ID' | 'MSG91_OTP_TEMPLATE_ID'
>

export function isPhoneAuthEnabled(env: PhoneAuthEnv): boolean {
  const fullyConfigured = Boolean(
    env.MSG91_AUTH_KEY && env.MSG91_SENDER_ID && env.MSG91_OTP_TEMPLATE_ID,
  )
  if (fullyConfigured) return true
  // Unconfigured: available only where the dev bypass is legal.
  return env.NODE_ENV !== 'production'
}

/**
 * The server half of the availability contract: better-auth's verifyOTP
 * hook delegates here, so a verification is only ever accepted when the
 * same predicate that shows the phone tab says phone auth is available.
 * Covers the half-configured case the provider alone cannot: a truthy
 * auth key with a missing sender/template would otherwise reach MSG91.
 */
export async function verifyOtpIfPhoneAuthEnabled(
  env: PhoneAuthEnv,
  config: Msg91Config,
  phoneNumber: string,
  code: string,
): Promise<boolean> {
  if (!isPhoneAuthEnabled(env)) return false
  return verifyOtpViaMsg91(config, phoneNumber, code)
}
