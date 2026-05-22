import { sql } from 'drizzle-orm'
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Append-only event log. Every privileged or money-relevant action
 * writes a row here — Vendor approval, refund approval, payout
 * disbursement, sub-admin permission change, KYC tier transition,
 * commission resolution, etc.
 *
 * `actor_user_id` is nullable so system actions (auto-completion of
 * Bookings at end_at+24h per ADR-0003, scheduled payout batch jobs
 * per ADR-0016) can write rows without a synthetic system user.
 *
 * Updates are NOT permitted at the application layer — `audit_logs`
 * is conceptually append-only. We do not add a DB trigger that blocks
 * UPDATE here in M1; the convention is enforced by the
 * `lib/audit/write.ts` helper introduced in M2.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorUserId: text('actor_user_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    payload: jsonb('payload').default(sql`'{}'::jsonb`).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .default(sql`now()`)
      .notNull(),
  },
  (t) => [
    index('audit_logs_by_entity').on(t.entityType, t.entityId),
    index('audit_logs_by_actor').on(t.actorUserId),
    index('audit_logs_by_time').on(t.createdAt),
    index('audit_logs_by_action').on(t.action),
  ],
)

export type AuditLog = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert
