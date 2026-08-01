import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getLocale, getMessages } from 'next-intl/server'

import { auth } from '@/lib/auth'
import { IntlProvider } from '@/lib/i18n/provider'

/** Where an anonymous visitor to any `/vendor` page returns after signing in. */
const VENDOR_SIGN_IN_RETURN_PATH = '/vendor/onboarding'

/**
 * Auth-only shell for the entire `/vendor` surface.
 *
 * The vendor-profile gate (redirect to /vendor/onboarding for users
 * without a profile) lives in the nested `(dashboard)` route group —
 * NOT here. Onboarding sits directly under this layout, so a signed-up
 * user with no profile can reach the onboarding wizard without the gate
 * redirecting `/vendor/onboarding` back to itself (an infinite loop).
 */
export default async function VendorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    // Carry the vendor intent through sign-in. Without this the funnel
    // dead-ends: a brand-new signup has no vendor_profiles row, so post-auth
    // routing sends them to the CUSTOMER dashboard and they never reach the
    // onboarding wizard — which is why vendors who "signed up" never appeared
    // in the admin dashboard.
    //
    // Onboarding is the right target for the whole `/vendor` surface: a user
    // who already HAS a profile is forwarded on to /vendor/dashboard by
    // app/vendor/onboarding/page.tsx, so this never strands anyone.
    redirect(`/sign-in?next=${encodeURIComponent(VENDOR_SIGN_IN_RETURN_PATH)}`)
  }

  const [locale, messages] = await Promise.all([getLocale(), getMessages()])

  return (
    <IntlProvider locale={locale} messages={messages as Record<string, unknown>}>
      {children}
    </IntlProvider>
  )
}
