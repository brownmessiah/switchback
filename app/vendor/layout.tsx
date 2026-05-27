import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getLocale, getMessages } from 'next-intl/server'

import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { requireVendorProfile } from '@/lib/auth/permissions'
import { IntlProvider } from '@/lib/i18n/provider'

import { VendorSidebar } from './vendor-sidebar'

export default async function VendorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) {
    redirect('/sign-in')
  }

  // Gate: user must have a vendor_profiles row. Redirects to
  // /vendor/onboarding if no vendor profile exists (per ADR-0006).
  await requireVendorProfile(db, session.user.id)

  const [locale, messages] = await Promise.all([getLocale(), getMessages()])

  return (
    <IntlProvider locale={locale} messages={messages as Record<string, unknown>}>
      <div className="flex min-h-[80vh]">
        <VendorSidebar userName={session.user.name ?? 'Vendor'} />
        <main className="flex-1 px-4 py-8 sm:px-8 lg:px-12">{children}</main>
      </div>
    </IntlProvider>
  )
}
