import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { db } from '@/db/client'
import { adminProfiles } from '@/db/schema'
import { auth } from '@/lib/auth'
import { cn } from '@/lib/utils'

/*
 * Child routes should call `requirePermission(db, userId, '<permission>')`
 * from `@/lib/auth/permissions` to gate access to specific admin features.
 * The layout only verifies admin_profiles row existence; per-page permission
 * checks belong in the page/route handler (e.g., the Vendors page checks
 * 'vendors', the Payouts page checks 'payouts').
 */

const NAV_ITEMS = [
  { href: '/admin/dashboard', label: 'Overview' },
  { href: '/admin/vendors', label: 'Vendors' },
  { href: '/admin/payouts', label: 'Payouts' },
]

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

  return (
    <div className="min-h-[80vh]">
      <div className="border-b">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 sm:px-6">
          <span className="py-3 text-sm font-semibold text-primary">Admin</span>
          <nav className="flex gap-4">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="border-b-2 border-transparent py-3 text-sm text-muted-foreground hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
