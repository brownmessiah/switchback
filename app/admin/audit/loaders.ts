import { and, desc, eq, gte, ilike, lte, sql, type SQL } from 'drizzle-orm'

import { auditLogs } from '@/db/schema/audit-logs'
import { users } from '@/db/schema/users'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

// ── Types ──────────────────────────────────────────────────────────

export interface AuditLogFilters {
  entityType?: string
  action?: string
  actorUserId?: string
  dateFrom?: Date
  dateTo?: Date
  limit?: number
  offset?: number
}

export interface AuditLogRow {
  id: string
  actorUserId: string | null
  action: string
  entityType: string
  entityId: string
  payload: unknown
  createdAt: Date
  actorEmail: string | null
  actorName: string | null
}

export interface AuditLogResult {
  rows: AuditLogRow[]
  total: number
}

// ── Query ──────────────────────────────────────────────────────────

export async function queryAuditLogs(
  db: DBOrTx,
  filters: AuditLogFilters = {},
): Promise<AuditLogResult> {
  const conditions: SQL[] = []

  if (filters.entityType) {
    conditions.push(eq(auditLogs.entityType, filters.entityType))
  }

  if (filters.action) {
    conditions.push(ilike(auditLogs.action, `%${filters.action}%`))
  }

  if (filters.actorUserId) {
    conditions.push(eq(auditLogs.actorUserId, filters.actorUserId))
  }

  if (filters.dateFrom) {
    conditions.push(gte(auditLogs.createdAt, filters.dateFrom))
  }

  if (filters.dateTo) {
    conditions.push(lte(auditLogs.createdAt, filters.dateTo))
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  // Count total matching rows
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(whereClause)

  const total = countResult?.count ?? 0

  // Fetch paginated rows with actor info
  const pageLimit = filters.limit ?? 50
  const pageOffset = filters.offset ?? 0

  const rows = await db
    .select({
      id: auditLogs.id,
      actorUserId: auditLogs.actorUserId,
      action: auditLogs.action,
      entityType: auditLogs.entityType,
      entityId: auditLogs.entityId,
      payload: auditLogs.payload,
      createdAt: auditLogs.createdAt,
      actorEmail: users.email,
      actorName: users.name,
    })
    .from(auditLogs)
    .leftJoin(users, eq(auditLogs.actorUserId, users.id))
    .where(whereClause)
    .orderBy(desc(auditLogs.createdAt))
    .limit(pageLimit)
    .offset(pageOffset)

  return { rows, total }
}

// ── Distinct values for filter dropdowns ───────────────────────────

export async function getDistinctEntityTypes(db: DBOrTx): Promise<string[]> {
  const result = await db
    .selectDistinct({ entityType: auditLogs.entityType })
    .from(auditLogs)
    .orderBy(auditLogs.entityType)

  return result.map((r) => r.entityType)
}

export async function getDistinctActions(db: DBOrTx): Promise<string[]> {
  const result = await db
    .selectDistinct({ action: auditLogs.action })
    .from(auditLogs)
    .orderBy(auditLogs.action)

  return result.map((r) => r.action)
}
