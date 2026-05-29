import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getLocale, getMessages } from 'next-intl/server'

import { auth } from '@/lib/auth'
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
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    redirect('/sign-in')
  }

  const [locale, messages] = await Promise.all([getLocale(), getMessages()])

  return (
    <IntlProvider locale={locale} messages={messages as Record<string, unknown>}>
      {children}
    </IntlProvider>
  )
}
