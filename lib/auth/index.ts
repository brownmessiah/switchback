import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { phoneNumber } from 'better-auth/plugins/phone-number'

import { db } from '@/db/client'
import { accounts, sessions, users, verifications } from '@/db/schema'
import { env } from '@/lib/env'

import { sendOtpViaMsg91, verifyOtpViaMsg91, type Msg91Config } from './msg91-provider'
import {
  isValidPhoneNumber,
  tempEmailForPhone,
  tempNameForPhone,
} from './phone-identity'

const msg91Config: Msg91Config = {
  authKey: env.MSG91_AUTH_KEY ?? '',
  senderId: env.MSG91_SENDER_ID ?? '',
  templateId: env.MSG91_OTP_TEMPLATE_ID ?? '',
}

/**
 * better-auth instance backing every authentication flow on the
 * Outvers app. Composition:
 *
 *  - drizzleAdapter over Postgres (Neon Mumbai).
 *  - Google OAuth (Customer-side signup; Vendors typically use phone).
 *  - phoneNumber plugin delegating OTP send + verify to MSG91.
 *  - nextCookies for App Router session cookie handling.
 *
 * Marketplace roles (Customer/Vendor/Admin) are NOT modelled here —
 * they attach via the profile tables (customer_profiles, etc.) per
 * ADR-0006 and are resolved from the URL route group in the App
 * Router.
 */
export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.NEXT_PUBLIC_APP_URL,
  // ADR-0019: trust the app's own origin (the prod domain / Cloud Run URL behind
  // the LB) PLUS optional extra origins (comma-separated `AUTH_TRUSTED_ORIGINS`),
  // so sign-in is not rejected as an "invalid origin". The ngrok dev-tunnel hosts
  // are removed — the demo runs on Cloud Run behind the LB.
  trustedOrigins: [
    env.NEXT_PUBLIC_APP_URL,
    ...(process.env.AUTH_TRUSTED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? []),
  ],
  emailAndPassword: { enabled: true },
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
    },
  },
  plugins: [
    phoneNumber({
      sendOTP: async ({ phoneNumber: phone }) => {
        // MSG91 generates and stores its own OTP — the `code` arg
        // from better-auth is therefore unused. better-auth still
        // tracks the verification attempt for rate limiting.
        const result = await sendOtpViaMsg91(msg91Config, phone)

        // The result must NOT be swallowed. better-auth reports "code sent"
        // purely on this callback returning, so ignoring a failure would send
        // the user to a code screen for an SMS that never left — indefinitely,
        // and with no signal anywhere that MSG91 is misconfigured.
        if (!result.success) {
          throw new Error(`MSG91 OTP send failed: ${result.reason}`)
        }
      },
      verifyOTP: async ({ phoneNumber: phone, code }) => {
        return verifyOtpViaMsg91(msg91Config, phone, code)
      },
      otpLength: 6,
      expiresIn: 300,
      requireVerification: true,
      // Reject a malformed number BEFORE it reaches MSG91. Without a country
      // code the SMS cannot be routed, so an unvalidated send is spend on a
      // message nobody receives.
      phoneNumberValidator: (phone) => isValidPhoneNumber(phone),
      /**
       * Phone is a first-class SIGNUP method, not only a verification step on
       * an existing account (ADR-0007 Tier 1 is defined as "MSG91 OTP
       * confirmed at signup", which was previously true of nobody — the only
       * signup path was email + password).
       *
       * better-auth requires an email on every user, so a phone-only account
       * gets a placeholder on the RFC 2606 reserved `.invalid` domain. It is
       * unregistrable and never resolves, and `isPlaceholderEmail` gates every
       * send so we never bounce mail at it.
       */
      signUpOnVerification: {
        getTempEmail: tempEmailForPhone,
        getTempName: tempNameForPhone,
      },
    }),
    nextCookies(),
  ],
})

export type Auth = typeof auth
