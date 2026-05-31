import {
  Anchor,
  Compass,
  Footprints,
  Mountain,
  Snowflake,
  TentTree,
  Tractor,
  Waves,
  Wind,
  type LucideIcon,
} from 'lucide-react'

/**
 * Activity-slug → lucide icon map for the home activity-category chips
 * (DESIGN.md B1 hero · §1.3 status/category never conveyed by glyph alone — the
 * chip always carries its display label as text; the icon is a redundancy cue).
 *
 * Slugs mirror the controlled-vocabulary registry (`lib/activities/registry.ts`).
 * Unknown slugs fall back to a neutral compass so the chip still renders an icon.
 */
const ACTIVITY_ICONS: Record<string, LucideIcon> = {
  rafting: Waves,
  kayaking: Waves,
  'scuba-diving': Anchor,
  scuba: Anchor,
  paragliding: Wind,
  'bungee-jumping': Wind,
  trekking: Footprints,
  'rock-climbing': Mountain,
  skiing: Snowflake,
  safari: Tractor,
  camping: TentTree,
}

export function getActivityIcon(activitySlug: string): LucideIcon {
  return ACTIVITY_ICONS[activitySlug] ?? Compass
}
