import { sql } from 'drizzle-orm'
import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

import { users } from './users'

/**
 * AI-assisted surfaces per ADR-0010. Every AI generation writes a row
 * here so the provenance trail is structurally part of the system,
 * not just a side-effect log.
 *
 * Surface taxonomy:
 *   review_summary  — extractive bullet summary of Customer reviews
 *                     (citation_traces is the load-bearing field —
 *                     bullets without verifiable traces are dropped
 *                     before render).
 *   listing_draft   — Vendor onboarding listing first-draft generation
 *   inbox_reply     — Vendor inbox reply suggestion (draft only, never
 *                     auto-sent; Vendor must edit-and-send).
 *   trip_planner    — RAG-constrained day-by-day itinerary; output
 *                     references valid experience_id only.
 *
 * `citation_traces` defaults to '[]' and is NOT NULL — the application
 * layer enforces "no review_summary without verifiable citations" by
 * dropping bullets whose citations are not in the source review set.
 */
export const aiSurfaceEnum = pgEnum('ai_surface', [
  'review_summary',
  'listing_draft',
  'inbox_reply',
  'trip_planner',
])

export const aiGenerations = pgTable('ai_generations', {
  id: uuid('id').primaryKey().defaultRandom(),
  surface: aiSurfaceEnum('surface').notNull(),
  model: text('model').notNull(),
  modelVersion: text('model_version').notNull(),
  promptTemplateHash: text('prompt_template_hash').notNull(),
  inputFingerprint: text('input_fingerprint').notNull(),
  output: jsonb('output').notNull(),
  retrievalSet: jsonb('retrieval_set').default(sql`'[]'::jsonb`).notNull(),
  citationTraces: jsonb('citation_traces').default(sql`'[]'::jsonb`).notNull(),
  // Customer or Vendor who triggered the generation. Nullable for
  // scheduled batch generations (e.g. nightly review-summary refresh).
  requestedByUserId: text('requested_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .default(sql`now()`)
    .notNull(),
})

export type AiGeneration = typeof aiGenerations.$inferSelect
export type NewAiGeneration = typeof aiGenerations.$inferInsert
