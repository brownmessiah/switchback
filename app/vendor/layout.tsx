import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getLocale, getMessages } from 'next-intl/server'

import { auth } from '@/lib/auth'
import { sanitizeReturnTo } from '@/lib/auth/return-to'
import { IntlProvider } from '@/lib/i18n/provider'

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
  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })
  if (!session?.user) {
    // Carry the visitor's destination through authentication
    // (launch-readiness 02): a logged-out click on the Vendor CTA
    // (→ /vendor/onboarding) must land back here after sign-up/sign-in,
    // not on the Customer dashboard. x-request-path is stamped by
    // proxy.ts for i18n-excluded routes; sanitizeReturnTo guards it
    // (it is client-spoofable, and a hostile value must degrade to the
    // bare redirect, never break the sign-in URL).
    const requestPath = sanitizeReturnTo(requestHeaders.get('x-request-path'))
    redirect(
      requestPath
        ? `/sign-in?returnTo=${encodeURIComponent(requestPath)}`
        : '/sign-in',
    )
  }

  const [locale, messages] = await Promise.all([getLocale(), getMessages()])

  return (
    <IntlProvider locale={locale} messages={messages as Record<string, unknown>}>
      {children}
    </IntlProvider>
  )
}
