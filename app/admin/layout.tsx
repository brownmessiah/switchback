import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getLocale, getMessages } from 'next-intl/server'

import { db } from '@/db/client'
import { adminProfiles } from '@/db/schema'
import { auth } from '@/lib/auth'
import { IntlProvider } from '@/lib/i18n/provider'

import { getAdminBadgeCounts } from './admin-badge-counts'
import { filterNavByPermissions } from './admin-nav'
import { AdminSidebar } from './admin-sidebar'

/*
 * Child routes should call `requirePermission(db, userId, '<permission>')`
 * from `@/lib/auth/permissions` to gate access to specific admin features.
 * The layout only verifies admin_profiles row existence; per-page permission
 * checks belong in the page/route handler (e.g., the Vendors page checks
 * 'vendors', the Payouts page checks 'payouts').
 */

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()

  const [admin] = await db
    .select()
    .from(adminProfiles)
    .where(eq(adminProfiles.userId, session.user.id))
    .limit(1)

  if (!admin) notFound()

  const [groups, badgeCounts, locale, messages] = await Promise.all([
    Promise.resolve(filterNavByPermissions(admin.permissions)),
    getAdminBadgeCounts(),
    getLocale(),
    getMessages(),
  ])

  return (
    <IntlProvider locale={locale} messages={messages as Record<string, unknown>}>
      <div className="flex min-h-[80vh]">
        <AdminSidebar groups={groups} badgeCounts={badgeCounts} />
        {/* One shared content shell for EVERY admin route: a single padding +
            max-width container centred in the remaining space, so no route
            renders at a different scale/width than the others (B1 shell-width
            audit). min-w-0 lets wide tables scroll instead of stretching the
            shell. */}
        <main className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[88rem]">{children}</div>
        </main>
      </div>
    </IntlProvider>
  )
}
