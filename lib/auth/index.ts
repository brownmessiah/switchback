import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { nextCookies } from 'better-auth/next-js'
import { phoneNumber } from 'better-auth/plugins/phone-number'

import { db } from '@/db/client'
import { accounts, sessions, users, verifications } from '@/db/schema'
import { env } from '@/lib/env'

import { sendOtpViaMsg91, type Msg91Config } from './msg91-provider'
import { verifyOtpIfPhoneAuthEnabled } from './otp-availability'
import { throwIfOtpSendFailed } from './otp-send-error'
import { isValidIndianE164PhoneNumber } from './phone-number-validator'
import { getPhoneTempEmail } from './phone-temp-identity'

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
  // launch-readiness 03 / PRD story 34 (OTP rate limiting): deliberately
  // NOT setting `rateLimit: { enabled: true }` here. See the comment
  // above the `phoneNumber` plugin below for the reasoning and the
  // regression this avoids.
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
    // launch-readiness 03 / PRD story 34 (OTP rate limiting) — the honest
    // account of what is and is not covered:
    //
    // Supplying `opts.verifyOTP` below bypasses better-auth's own OTP
    // store, expiry, and `allowedAttempts` counter entirely (routes.mjs's
    // verify handler only reads that store in the ELSE branch, which never
    // runs once verifyOTP is set) — so that per-attempt counter is INERT
    // no matter what is configured on `auth`. There is no realistic way to
    // reactivate it without dropping the MSG91 delegation this plugin
    // exists for.
    //
    // The plugin itself registers a `{ pathMatcher: startsWith('/phone-number'),
    // window: 60, max: 10 }` rule with better-auth's core rate limiter —
    // per (client IP, exact path), independent of verifyOTP, since it runs
    // in the request pipeline before the endpoint handler. This DOES bound
    // the "`/phone-number/send-otp` writes a `verifications` row per call,
    // unbounded" growth RECON.md §G.5 flagged. It does NOT bound a
    // distributed attack spread across many IPs against one phone number
    // (would need a bespoke per-identifier counter — out of scope here).
    //
    // TRIED AND REVERTED: explicitly setting `rateLimit: { enabled: true }`
    // on `auth` above to activate this in dev/test/E2E too (rather than
    // relying on better-auth's own `isProduction` default). Measured
    // regression: better-auth's core rate limiter ALSO auto-applies its
    // own hardcoded default special rules the moment the master switch is
    // on — `{ window: 10, max: 3 }` on every `/sign-in/*` and `/sign-up/*`
    // path (there is no per-plugin opt-out for those, only a `customRules`
    // deny-list keyed by literal/wildcard path, which would mean
    // maintaining a shadow copy of better-auth's own internal defaults).
    // That immediately broke unrelated, pre-existing E2E flows with
    // "Too many requests" (verified via `git stash` A/B:
    // tests/e2e/specs/unauthenticated/vendor-signup-journey.spec.ts's
    // "protocol-relative returnTo is ignored too" — 6/6 pass on the base
    // branch, 5/6 with the override, the 6th hanging on a 3-per-10s email
    // sign-up/sign-in throttle it never had before). Reverted: this
    // codebase's whole test suite assumes email auth is unthrottled in
    // dev/test, matching better-auth's own `isProduction` default — an
    // override was neither necessary (the phoneNumber plugin's own rule
    // still activates automatically in production, where the threat model
    // actually applies) nor safe to introduce as a side effect of this
    // slice.
    phoneNumber({
      sendOTP: async ({ phoneNumber: phone }) => {
        // MSG91 generates and stores its own OTP — the `code` arg
        // from better-auth is therefore unused. better-auth still
        // tracks the verification attempt for rate limiting.
        //
        // launch-readiness 03: a bare `await` here used to discard the
        // SendOtpResult, so a failed MSG91 send still answered 200 "code
        // sent" and the sign-in UI advanced to a code-entry step no code
        // was ever sent for. throwIfOtpSendFailed surfaces the failure as
        // a non-2xx response instead.
        const result = await sendOtpViaMsg91(msg91Config, phone)
        throwIfOtpSendFailed(result)
      },
      verifyOTP: async ({ phoneNumber: phone, code }) => {
        // Availability-gated (launch-readiness 01): shares
        // lib/auth/otp-availability with the sign-in UI, so a hidden
        // phone tab cannot be bypassed by calling the endpoint directly.
        return verifyOtpIfPhoneAuthEnabled(env, msg91Config, phone, code)
      },
      otpLength: 6,
      expiresIn: 300,
      requireVerification: true,
      // Defense-in-depth (see lib/auth/phone-number-validator): our own
      // client only ever sends this exact E.164 shape, but this is a
      // client-callable endpoint — reject anything else up front with a
      // clean INVALID_PHONE_NUMBER rather than minting a verification
      // row (or, via signUpOnVerification, a User) for a garbage value.
      phoneNumberValidator: (phone) => isValidIndianE164PhoneNumber(phone),
      // launch-readiness 03: phone is a full alternative identity, not a
      // second factor — a valid OTP for a number with no User creates
      // one. Without this option better-auth's own verify handler throws
      // INTERNAL_SERVER_ERROR / FAILED_TO_UPDATE_USER for unknown numbers
      // (RECON.md §A1). The temp email is intentionally NOT under
      // @seed.outvers.dev — see lib/auth/phone-temp-identity.
      signUpOnVerification: {
        getTempEmail: getPhoneTempEmail,
      },
    }),
    nextCookies(),
  ],
})

export type Auth = typeof auth
