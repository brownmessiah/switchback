import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { NotificationPreferences } from '@/components/notification-preferences'
import { db } from '@/db/client'
import { customerProfiles } from '@/db/schema/customer-profiles'
import { users } from '@/db/schema/users'
import { auth } from '@/lib/auth'
import type { CustomerAddress } from '@/lib/customer/profile'

import { ProfileForm } from './profile-form'

/**
 * Customer account settings (ADR-0006). Auth-gated, excluded from i18n
 * locale routing (lib/i18n/routing.ts). Edits the display identity
 * (`users.name` / `users.image`), the default address + trusted contact
 * (`customer_profiles`), and mounts the previously-orphaned
 * NotificationPreferences grid which writes `notification_preferences`.
 */
export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) redirect('/sign-in')

  const userId = session.user.id
  const t = await getTranslations('SettingsPage')

  const [userRow] = await db
    .select({ name: users.name, image: users.image })
    .from(users)
    .where(eq(users.id, userId))

  const [profileRow] = await db
    .select({
      defaultAddress: customerProfiles.defaultAddress,
      trustedContactName: customerProfiles.trustedContactName,
      trustedContactPhone: customerProfiles.trustedContactPhone,
      trustedContactRelationship: customerProfiles.trustedContactRelationship,
    })
    .from(customerProfiles)
    .where(eq(customerProfiles.userId, userId))

  const rawAddress = profileRow?.defaultAddress as Partial<CustomerAddress> | null | undefined
  const address: CustomerAddress | null = rawAddress
    ? {
        line1: rawAddress.line1 ?? '',
        city: rawAddress.city ?? '',
        state: rawAddress.state ?? '',
        pincode: rawAddress.pincode ?? '',
      }
    : null

  return (
    <main
      data-testid="customer-settings"
      className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-12"
    >
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <ProfileForm
        initial={{
          displayName: userRow?.name ?? '',
          avatarUrl: userRow?.image ?? '',
          address,
          trustedContactName: profileRow?.trustedContactName ?? '',
          trustedContactPhone: profileRow?.trustedContactPhone ?? '',
          trustedContactRelationship: profileRow?.trustedContactRelationship ?? '',
        }}
      />

      {/* Previously-orphaned NotificationPreferences grid — now mounted and
          reachable. Per-event × channel opt-out toggles write
          notification_preferences via the existing actions. */}
      <section className="mt-10 border-t pt-8" data-testid="notification-preferences">
        <NotificationPreferences userId={userId} />
      </section>
    </main>
  )
}
