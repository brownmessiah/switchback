import 'server-only'

import Anthropic from '@anthropic-ai/sdk'

import { env } from '@/lib/env'

/**
 * Thin, mockable wrapper around the Anthropic SDK for the trip planner.
 *
 * SECURITY: the API key lives ONLY in this server module (guarded by
 * `server-only`). It is never imported by a client component and never
 * reaches the browser bundle (ADR-0010 + project security rules).
 *
 * The model is constrained to recommend ONLY experiences from the supplied
 * retrieval set: structured JSON output via a forced tool call, and the
 * candidate list is given verbatim in the prompt. Drop-invalid-IDs still
 * happens at the response layer in trip-planner.ts — the model constraint is
 * defence-in-depth, not the guarantee.
 */

/** One candidate experience offered to the model (the retrieval set). */
export interface RetrievalCandidate {
  id: string
  slug: string
  title: string
  shortDescription: string | null
  activitySlug: string
  regionSlug: string
  pricePerPersonRupees: number
}

export interface ItineraryDraftInput {
  model: string
  /** Pre-rendered, deterministic instruction text (stable cache prefix). */
  systemPrompt: string
  /** The volatile, per-request user instruction. */
  userPrompt: string
  retrievalSet: RetrievalCandidate[]
}

/** Shape the model is asked to return (validated again in trip-planner.ts). */
export interface ClaudeItineraryDraft {
  days: {
    dayNumber: number
    title: string
    items: { experienceId: string; rationale: string }[]
  }[]
  packingList: string[]
}

/** True only when a real Anthropic key is configured (server-side). */
export function isClaudeConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY)
}

let cachedClient: Anthropic | null = null

function getClient(): Anthropic {
  if (!cachedClient) {
    cachedClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  }
  return cachedClient
}

/**
 * The structured-output tool. Forcing this tool guarantees the model returns
 * JSON matching our shape rather than free text — and every item must carry an
 * `experience_id` chosen from the retrieved candidates.
 */
const ITINERARY_TOOL: Anthropic.Tool = {
  name: 'emit_itinerary',
  description:
    'Return the day-by-day itinerary. Every item.experience_id MUST be one of the ' +
    'candidate experience ids provided in the prompt. Never invent an id.',
  input_schema: {
    type: 'object',
    properties: {
      days: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            dayNumber: { type: 'integer' },
            title: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  experienceId: { type: 'string' },
                  rationale: { type: 'string' },
                },
                required: ['experienceId', 'rationale'],
              },
            },
          },
          required: ['dayNumber', 'title', 'items'],
        },
      },
      packingList: { type: 'array', items: { type: 'string' } },
    },
    required: ['days', 'packingList'],
  },
}

/**
 * Call Claude to produce an itinerary draft constrained to the retrieval set.
 * Returns the raw draft; grounding validation happens in the caller.
 */
export async function generateItineraryDraft(
  input: ItineraryDraftInput,
): Promise<ClaudeItineraryDraft> {
  const client = getClient()

  const candidateBlock = input.retrievalSet
    .map(
      (c) =>
        `- id=${c.id} | ${c.title} (${c.activitySlug} in ${c.regionSlug}) | ₹${c.pricePerPersonRupees}/person | ${c.shortDescription ?? ''}`,
    )
    .join('\n')

  const message = await client.messages.create({
    model: input.model,
    max_tokens: 4096,
    // Stable system prefix first (cacheable), then the volatile user turn.
    system: [
      {
        type: 'text',
        text: input.systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    tools: [ITINERARY_TOOL],
    tool_choice: { type: 'tool', name: ITINERARY_TOOL.name },
    messages: [
      {
        role: 'user',
        content: `${input.userPrompt}\n\nCandidate experiences (recommend ONLY these ids):\n${candidateBlock}`,
      },
    ],
  })

  const toolUse = message.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
  )
  if (!toolUse) {
    throw new Error('Claude did not return a structured itinerary')
  }

  return toolUse.input as ClaudeItineraryDraft
}
