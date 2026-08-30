import { createHash } from 'node:crypto'

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { aiGenerations } from '@/db/schema/ai-generations'
import { experiences } from '@/db/schema/experiences'
import { publiclyVisibleExperienceCondition } from '@/lib/experiences/public-filter'
import type { DBOrTx } from '@/lib/payments/commission-resolver'

import {
  generateItineraryDraft,
  isClaudeConfigured,
  type ClaudeItineraryDraft,
  type RetrievalCandidate,
} from './claude-client'
import { resolveModel } from './router'
import {
  TRAVEL_STYLES,
  tripPlannerInputSchema,
  type TravelStyle,
  type TripPlannerInput,
} from './trip-planner-constants'

// Re-export the client-safe constants/schema so existing server-side callers
// (and tests) can keep importing them from this module.
export { TRAVEL_STYLES, tripPlannerInputSchema }
export type { TravelStyle, TripPlannerInput }

/** A single recommended item, hydrated with the real PDP slug + title. */
export interface ItineraryItem {
  experienceId: string
  slug: string
  title: string
  shortDescription: string | null
  pricePerPersonRupees: number
  rationale: string
}

/** The model's raw item shape (pre-grounding). Exported for tests. */
export interface ItineraryItemDraft {
  experienceId: string
  rationale: string
}

export interface ItineraryDay {
  dayNumber: number
  title: string
  items: ItineraryItem[]
}

export interface Itinerary {
  days: ItineraryDay[]
  packingList: string[]
  /** Visible AI label flag (ADR-0010): always true. */
  aiAssisted: boolean
  /** Model id recorded for the generation (provenance/debug). */
  model: string
}

export interface GenerateOptions {
  requestedByUserId: string | null
}

/** How many candidate experiences to retrieve / offer to the model. */
const RETRIEVAL_LIMIT = 24

/** Stable system prompt — kept byte-identical so it caches (ADR-0010 + caching). */
const SYSTEM_PROMPT =
  'You are the Switchback trip planner. You build day-by-day adventure itineraries ' +
  'for India using ONLY the candidate experiences supplied in each request. ' +
  'You must never invent or recommend an experience that is not in the candidate ' +
  'list. Every itinerary item must reference a candidate experience_id verbatim. ' +
  'Spread the experiences sensibly across the requested number of days, write a ' +
  'short, concrete rationale per item, and produce a practical packing list ' +
  'appropriate to the activities and region. "Switchback" is a brand name — never ' +
  'translate it.'

/** Hash of the prompt template — provenance key for regression reproducibility. */
const PROMPT_TEMPLATE_HASH = createHash('sha256')
  .update(SYSTEM_PROMPT)
  .digest('hex')
  .slice(0, 16)

/** Zod schema validating the model's draft shape before grounding. */
const draftSchema = z.object({
  days: z.array(
    z.object({
      dayNumber: z.number().int(),
      title: z.string().min(1),
      items: z.array(
        z.object({
          experienceId: z.string().min(1),
          rationale: z.string().default(''),
        }),
      ),
    }),
  ),
  packingList: z.array(z.string()),
})

/** Deterministic fingerprint of the inputs (provenance). */
function fingerprintInput(input: TripPlannerInput): string {
  const canonical = JSON.stringify({
    region: input.region,
    activity: input.activity ?? null,
    days: input.days,
    budgetRupees: input.budgetRupees,
    groupSize: input.groupSize,
    travelStyle: input.travelStyle,
  })
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16)
}

/**
 * RETRIEVAL: publicly-visible experiences matching the region (and activity
 * when given), grounded directly in the canonical Postgres table. Search is
 * Postgres-native, so a direct DB query keeps retrieval reliable in every
 * environment, and grounding in real published experience IDs is the
 * point. The status gate is the shared `publiclyVisibleExperienceCondition()`
 * (status = 'published' AND not an admin/E2E fixture slug) so the AI surface
 * can never offer a fixture/test Experience as a candidate (ADR-0010 data
 * honesty) — see lib/experiences/public-filter.ts.
 */
async function retrieveCandidates(
  db: DBOrTx,
  input: TripPlannerInput,
): Promise<RetrievalCandidate[]> {
  const where = input.activity
    ? and(
        publiclyVisibleExperienceCondition(),
        eq(experiences.regionSlug, input.region),
        eq(experiences.activitySlug, input.activity),
      )
    : and(publiclyVisibleExperienceCondition(), eq(experiences.regionSlug, input.region))

  const rows = await db
    .select({
      id: experiences.id,
      slug: experiences.slug,
      title: experiences.title,
      shortDescription: experiences.shortDescription,
      activitySlug: experiences.activitySlug,
      regionSlug: experiences.regionSlug,
      price: experiences.pricePerPerson_1_2,
    })
    .from(experiences)
    .where(where)
    .limit(RETRIEVAL_LIMIT)

  return rows.map(
    (r): RetrievalCandidate => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      shortDescription: r.shortDescription,
      activitySlug: r.activitySlug,
      regionSlug: r.regionSlug,
      pricePerPersonRupees: Math.round(Number(r.price)),
    }),
  )
}

/**
 * Deterministic, still-RAG-grounded fallback used when no Claude key is
 * configured. Round-robins the retrieved candidates across the requested days
 * so the page stays functional in dev/demo/tests. Output references only real
 * retrieved ids — grounding is preserved without any model call.
 */
function deterministicDraft(
  candidates: RetrievalCandidate[],
  input: TripPlannerInput,
): ClaudeItineraryDraft {
  const days: ClaudeItineraryDraft['days'] = []
  for (let d = 0; d < input.days; d++) {
    days.push({ dayNumber: d + 1, title: `Day ${d + 1}`, items: [] })
  }
  candidates.forEach((candidate, idx) => {
    const day = days[idx % input.days]!
    day.items.push({
      experienceId: candidate.id,
      rationale: `${candidate.title} — a ${candidate.activitySlug.replace(/-/g, ' ')} experience in ${candidate.regionSlug.replace(/-/g, ' ')}.`,
    })
  })

  const activitySet = new Set(candidates.map((c) => c.activitySlug))
  const packingList = buildPackingList(activitySet, input.travelStyle)

  return { days, packingList }
}

/** A pragmatic packing list derived from the retrieved activities + style. */
function buildPackingList(activities: Set<string>, style: TravelStyle): string[] {
  const list = new Set<string>([
    'Government photo ID',
    'Refillable water bottle',
    'Sunscreen',
  ])
  if (activities.has('rafting') || activities.has('kayaking') || activities.has('scuba-diving')) {
    list.add('Quick-dry clothes')
    list.add('Sandals with grip')
  }
  if (activities.has('trekking') || activities.has('rock-climbing') || activities.has('camping')) {
    list.add('Trekking shoes')
    list.add('Light layers / fleece')
  }
  if (activities.has('skiing')) {
    list.add('Thermal wear')
    list.add('Gloves')
  }
  if (style === 'family') {
    list.add('First-aid basics')
  }
  return [...list]
}

/**
 * Ground a draft against the retrieval set: drop any item whose
 * `experienceId` is not in the retrieved candidates (ADR-0010), hydrate the
 * survivors with the real slug/title/price, and drop now-empty days only if
 * the day index exceeds the requested count.
 */
function groundDraft(
  draft: ClaudeItineraryDraft,
  byId: Map<string, RetrievalCandidate>,
  requestedDays: number,
): { days: ItineraryDay[]; citedIds: string[] } {
  const citedIds: string[] = []
  const days: ItineraryDay[] = []

  for (const day of draft.days) {
    if (day.dayNumber < 1 || day.dayNumber > requestedDays) continue
    const items: ItineraryItem[] = []
    for (const item of day.items) {
      const candidate = byId.get(item.experienceId)
      if (!candidate) continue // hallucinated / out-of-set id → DROPPED
      citedIds.push(candidate.id)
      items.push({
        experienceId: candidate.id,
        slug: candidate.slug,
        title: candidate.title,
        shortDescription: candidate.shortDescription,
        pricePerPersonRupees: candidate.pricePerPersonRupees,
        rationale: item.rationale,
      })
    }
    days.push({ dayNumber: day.dayNumber, title: day.title, items })
  }

  // Ensure every requested day is present (even if empty after grounding).
  const present = new Set(days.map((d) => d.dayNumber))
  for (let n = 1; n <= requestedDays; n++) {
    if (!present.has(n)) days.push({ dayNumber: n, title: `Day ${n}`, items: [] })
  }
  days.sort((a, b) => a.dayNumber - b.dayNumber)

  return { days, citedIds }
}

/**
 * Generate a RAG-grounded, day-by-day itinerary.
 *
 * 1. RETRIEVE published experiences for the inputs (the retrieval set).
 * 2. GENERATE a draft — Claude when a key is configured, else a deterministic
 *    still-grounded fallback.
 * 3. VALIDATE with Zod and DROP any item whose experience_id ∉ retrieval set.
 * 4. WRITE an `ai_generations` provenance row (surface 'trip_planner').
 * 5. RETURN the validated itinerary.
 */
export async function generateItinerary(
  db: DBOrTx,
  rawInput: TripPlannerInput,
  options: GenerateOptions,
): Promise<Itinerary> {
  const input = tripPlannerInputSchema.parse(rawInput)
  const candidates = await retrieveCandidates(db, input)
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const retrievalIds = candidates.map((c) => c.id)

  const useClaude = isClaudeConfigured() && candidates.length > 0
  const assignment = resolveModel('trip_planner')

  let rawDraft: unknown
  let model: string
  let modelVersion: string

  if (useClaude) {
    model = assignment.model
    modelVersion = assignment.modelVersion
    const userPrompt =
      `Plan a ${input.days}-day ${input.travelStyle} trip to ${input.region} ` +
      `for a group of ${input.groupSize}, with a total budget of about ₹${input.budgetRupees}.` +
      (input.activity ? ` Focus on ${input.activity}.` : '')
    rawDraft = await generateItineraryDraft({
      model,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      retrievalSet: candidates,
    })
  } else {
    model = 'retrieval-deterministic-v1'
    modelVersion = 'retrieval-deterministic-v1'
    rawDraft = deterministicDraft(candidates, input)
  }

  // VALIDATE: a malformed model draft degrades to the deterministic path
  // rather than throwing — the page must stay functional.
  const parsed = draftSchema.safeParse(rawDraft)
  const draft: ClaudeItineraryDraft = parsed.success
    ? parsed.data
    : deterministicDraft(candidates, input)

  const { days, citedIds } = groundDraft(draft, byId, input.days)
  const packingList = draft.packingList.length
    ? draft.packingList
    : buildPackingList(new Set(candidates.map((c) => c.activitySlug)), input.travelStyle)

  // WRITE provenance (ADR-0010). citationTraces = grounded ids actually cited.
  await db.insert(aiGenerations).values({
    surface: 'trip_planner',
    model,
    modelVersion,
    promptTemplateHash: PROMPT_TEMPLATE_HASH,
    inputFingerprint: fingerprintInput(input),
    output: { days, packingList },
    retrievalSet: retrievalIds,
    citationTraces: [...new Set(citedIds)],
    requestedByUserId: options.requestedByUserId,
  })

  return { days, packingList, aiAssisted: true, model }
}
