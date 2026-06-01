/**
 * AI model router (ADR-0010 "Model routing").
 *
 * Concrete model IDs are resolved from configuration here, NOT hardcoded at
 * the call sites. Review summaries and the trip planner use the strongest
 * available model (justified by stakes); inbox/listing drafts use cheaper
 * models. Per-surface defaults can be overridden by env so launch-time
 * configuration is a config flip, not a code change.
 */

import { env } from '@/lib/env'

export type AiSurface = 'review_summary' | 'listing_draft' | 'inbox_reply' | 'trip_planner'

export interface ModelAssignment {
  /** Concrete model id passed to the provider SDK. */
  model: string
  /**
   * A coarse version tag recorded in `ai_generations.model_version` for
   * provenance. Defaults to the model id when no finer version is known.
   */
  modelVersion: string
}

/**
 * Per-surface default model ids. The trip planner is an interactive,
 * higher-stakes surface, so it routes to a strong Claude model by default.
 * Anything here is overridable by the matching env var.
 */
const DEFAULTS: Record<AiSurface, string> = {
  // claude-sonnet-4-6: strong, fast — good fit for the interactive trip planner.
  trip_planner: 'claude-sonnet-4-6',
  review_summary: 'claude-sonnet-4-6',
  listing_draft: 'claude-haiku-4-5',
  inbox_reply: 'claude-haiku-4-5',
}

function envOverride(surface: AiSurface): string | undefined {
  switch (surface) {
    case 'trip_planner':
      return env.AI_MODEL_TRIP_PLANNER
    default:
      return undefined
  }
}

/** Resolve the model assignment for a given AI surface. */
export function resolveModel(surface: AiSurface): ModelAssignment {
  const model = envOverride(surface) ?? DEFAULTS[surface]
  return { model, modelVersion: model }
}
