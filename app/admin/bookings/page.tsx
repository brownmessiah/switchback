import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { db } from '@/db/client'
import { auth } from '@/lib/auth'
import { requirePermission } from '@/lib/auth/permissions'

import { BookingFilters } from './booking-filters'
import { BookingsTable } from './bookings-table'
import {
  loadBookingsList,
  loadExperiencesForFilter,
  loadVendorsForFilter,
  type BookingListFilters,
} from './loaders'

// ── Page ────────────────────────────────────────────────────────────

interface AdminBookingsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function AdminBookingsPage({ searchParams }: AdminBookingsPageProps) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) notFound()
  await requirePermission(db, session.user.id, 'bookings')

  const params = await searchParams
  const filters: BookingListFilters = {
    state: typeof params.state === 'string' ? params.state : undefined,
    dateFrom: typeof params.dateFrom === 'string' ? params.dateFrom : undefined,
    dateTo: typeof params.dateTo === 'string' ? params.dateTo : undefined,
    vendorUserId: typeof params.vendor === 'string' ? params.vendor : undefined,
    experienceId: typeof params.experience === 'string' ? params.experience : undefined,
  }

  const [rows, vendors, experiencesList] = await Promise.all([
    loadBookingsList(db, filters),
    loadVendorsForFilter(db),
    loadExperiencesForFilter(db),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">All Bookings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {rows.length} booking{rows.length === 1 ? '' : 's'}
          {Object.values(filters).some(Boolean) ? ' (filtered)' : ''}
        </p>
      </div>

      <BookingFilters
        currentFilters={filters}
        vendors={vendors}
        experiences={experiencesList}
      />

      <BookingsTable rows={rows} />
    </div>
  )
}
