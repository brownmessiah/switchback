import { count, eq, sql, sum } from 'drizzle-orm'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import type * as schema from '@/db/schema'
import { bookings } from '@/db/schema/bookings'
import { experiences } from '@/db/schema/experiences'
import { users } from '@/db/schema/users'
import { vendorProfiles } from '@/db/schema/vendor-profiles'

type DBOrTx = PgDatabase<
  PgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

// ── Summary stats ─────────────────────────────────────────────────

export interface ReportSummary {
  readonly totalUsers: number
  readonly totalVendors: number
  readonly totalExperiences: number
  readonly totalBookings: number
  readonly totalRevenue: number
}

export async function loadReportSummary(db: DBOrTx): Promise<ReportSummary> {
  const [[userRow], [vendorRow], [expRow], [bookingRow]] = await Promise.all([
    db.select({ count: count() }).from(users),
    db.select({ count: count() }).from(vendorProfiles),
    db.select({ count: count() }).from(experiences),
    db
      .select({
        count: count(),
        revenue: sum(bookings.grossTotalSnapshot),
      })
      .from(bookings),
  ])

  return {
    totalUsers: userRow?.count ?? 0,
    totalVendors: vendorRow?.count ?? 0,
    totalExperiences: expRow?.count ?? 0,
    totalBookings: bookingRow?.count ?? 0,
    totalRevenue: Math.floor(Number(bookingRow?.revenue ?? 0)),
  }
}

// ── CSV export queries ────────────────────────────────────────────

export interface CsvUserRow {
  readonly id: string
  readonly name: string | null
  readonly email: string | null
  readonly phoneNumber: string | null
  readonly emailVerified: boolean
  readonly createdAt: Date
}

export async function loadUsersForCsv(db: DBOrTx): Promise<readonly CsvUserRow[]> {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      phoneNumber: users.phoneNumber,
      emailVerified: users.emailVerified,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(users.createdAt)
}

export interface CsvVendorRow {
  readonly userId: string
  readonly businessName: string
  readonly slug: string
  readonly kycTier: string
  readonly commissionRate: string
  readonly suspended: boolean
  readonly createdAt: Date
}

export async function loadVendorsForCsv(db: DBOrTx): Promise<readonly CsvVendorRow[]> {
  return db
    .select({
      userId: vendorProfiles.userId,
      businessName: vendorProfiles.businessName,
      slug: vendorProfiles.slug,
      kycTier: vendorProfiles.kycTier,
      commissionRate: vendorProfiles.commissionRate,
      suspended: vendorProfiles.suspended,
      createdAt: vendorProfiles.createdAt,
    })
    .from(vendorProfiles)
    .orderBy(vendorProfiles.createdAt)
}

export interface CsvBookingRow {
  readonly id: string
  readonly state: string
  readonly participantCount: number
  readonly grossTotalSnapshot: string
  readonly paymentMode: string
  readonly commissionRateSnapshot: string
  readonly customerEmail: string | null
  readonly experienceTitle: string
  readonly vendorBusinessName: string
  readonly confirmedAt: Date
}

export async function loadBookingsForCsv(db: DBOrTx): Promise<readonly CsvBookingRow[]> {
  return db
    .select({
      id: bookings.id,
      state: bookings.state,
      participantCount: bookings.participantCount,
      grossTotalSnapshot: bookings.grossTotalSnapshot,
      paymentMode: bookings.paymentMode,
      commissionRateSnapshot: bookings.commissionRateSnapshot,
      customerEmail: users.email,
      experienceTitle: experiences.title,
      vendorBusinessName: vendorProfiles.businessName,
      confirmedAt: bookings.confirmedAt,
    })
    .from(bookings)
    .innerJoin(experiences, eq(bookings.experienceId, experiences.id))
    .innerJoin(users, eq(bookings.customerUserId, users.id))
    .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
    .orderBy(bookings.confirmedAt)
}

export interface CsvExperienceRow {
  readonly id: string
  readonly title: string
  readonly slug: string
  readonly status: string
  readonly regionSlug: string
  readonly activitySlug: string
  readonly vendorBusinessName: string
  readonly pricePerPerson_1_2: string
  readonly cancellationPreset: string
  readonly createdAt: Date
}

export async function loadExperiencesForCsv(db: DBOrTx): Promise<readonly CsvExperienceRow[]> {
  return db
    .select({
      id: experiences.id,
      title: experiences.title,
      slug: experiences.slug,
      status: experiences.status,
      regionSlug: experiences.regionSlug,
      activitySlug: experiences.activitySlug,
      vendorBusinessName: vendorProfiles.businessName,
      pricePerPerson_1_2: experiences.pricePerPerson_1_2,
      cancellationPreset: experiences.cancellationPreset,
      createdAt: experiences.createdAt,
    })
    .from(experiences)
    .innerJoin(vendorProfiles, eq(experiences.vendorUserId, vendorProfiles.userId))
    .orderBy(experiences.createdAt)
}

// ── CSV serializer ────────────────────────────────────────────────

/**
 * Convert an array of objects to a CSV string. Escapes values containing
 * commas, quotes, or newlines per RFC 4180.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toCsv<T extends Record<string, any>>(
  rows: readonly T[],
  columns: readonly (keyof T & string)[],
): string {
  const escape = (val: unknown): string => {
    const str = val instanceof Date ? val.toISOString() : String(val ?? '')
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const header = columns.join(',')
  const body = rows.map((row) => columns.map((col) => escape(row[col])).join(',')).join('\n')
  return `${header}\n${body}`
}
