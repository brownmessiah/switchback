import Image from 'next/image'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Award, Flame, MapPin, ShieldCheck, Star } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { WishlistButton } from '@/components/wishlist-button'
import { resolveExperienceCover } from '@/lib/media/experience-images'

export interface ExperienceCardData {
  id: string
  slug: string
  title: string
  shortDescription?: string | null
  pricePerParticipantRupees: number
  regionSlug: string
  activitySlug: string
  vendorName?: string
  vendorKycTier?: 'phone' | 'identity' | 'business'
  /**
   * Real per-listing cover image URL from `media_assets` (parity-catchup/02).
   * When absent, the card falls back to the activity stock photo.
   */
  coverImageUrl?: string | null
  /**
   * When provided (Issue #08), the card renders a wishlist heart toggle
   * overlay seeded with this saved state. Public/logged-out lists that do
   * not pass it render NO button — the card's behaviour is unchanged when
   * the prop is absent.
   */
  isWishlisted?: boolean
  /**
   * Card tags (parity with outvers.com). All additive / nullable — a bare card
   * that passes none of these renders exactly as before (no empty badges).
   *
   *  - `difficulty`  — colour-coded operational-difficulty pill (a11y: the
   *    colour ALWAYS pairs with the i18n text label, never colour alone).
   *  - `ratingAvg` / `ratingCount` — published-review summary; the star rating
   *    only renders when `ratingCount > 0`.
   *  - `highlight` — at most one earned social-proof badge (see `deriveHighlight`).
   */
  difficulty?: 'easy' | 'moderate' | 'challenging' | 'extreme' | null
  ratingAvg?: number | null
  ratingCount?: number | null
  highlight?: 'bestseller' | 'top_rated' | null
}

interface ExperienceCardProps {
  experience: ExperienceCardData
}

const ACTIVITY_LABELS: Record<string, string> = {
  rafting: 'Rafting',
  paragliding: 'Paragliding',
  scuba: 'Scuba diving',
  'scuba-diving': 'Scuba diving',
  trekking: 'Trekking',
  kayaking: 'Kayaking',
  camping: 'Camping',
  bungee: 'Bungee jumping',
  skiing: 'Skiing',
  surfing: 'Surfing',
  canyoning: 'Canyoning',
}

const REGION_LABELS: Record<string, string> = {
  rishikesh: 'Rishikesh',
  manali: 'Manali',
  'bir-billing': 'Bir Billing',
  goa: 'Goa',
  ladakh: 'Ladakh',
  sikkim: 'Sikkim',
  kerala: 'Kerala',
  meghalaya: 'Meghalaya',
  andaman: 'Andaman',
  coorg: 'Coorg',
}

type Difficulty = 'easy' | 'moderate' | 'challenging' | 'extreme'

/**
 * Difficulty → colour mapping (DESIGN.md §1.3: colour ALWAYS paired with the
 * text label, never colour alone). Reuses semantic status tokens so the pills
 * have correct light + dark values automatically (globals.css):
 *   easy→success (green), moderate→warning-subtle (amber), challenging→a
 *   stronger solid warning fill (deep orange), extreme→destructive (red).
 */
const DIFFICULTY_BADGE: Record<
  Difficulty,
  { variant: 'success' | 'warning' | 'destructive'; className?: string }
> = {
  easy: { variant: 'success' },
  moderate: { variant: 'warning' },
  // "Strong orange" — solid warning fill (not the subtle tint) to read as a
  // deeper, more urgent orange while staying token-driven + dark-mode safe.
  challenging: {
    variant: 'warning',
    className: 'bg-warning text-warning-foreground',
  },
  extreme: { variant: 'destructive' },
}

/**
 * A1 Card (DESIGN.md §4) — decision-complete Experience tile.
 *
 * Unified card contract: `bg-card` (= --surface-1), `--radius-card`,
 * `--shadow-sm` resting → `--shadow-md` hover-lift (motion-reduce guarded).
 * Status overlay = a `--success` Free-cancellation Badge with a lucide icon
 * (status never by colour alone, §1.3). Price renders in `.tabular-nums`;
 * coral affordance uses `text-primary-strong` (AA-safe), never `text-primary`.
 */
export function ExperienceCard({ experience }: ExperienceCardProps) {
  const t = useTranslations('HomePage')
  const activityLabel = ACTIVITY_LABELS[experience.activitySlug] ?? experience.activitySlug
  const regionLabel = REGION_LABELS[experience.regionSlug] ?? experience.regionSlug
  const imageUrl = resolveExperienceCover(experience.coverImageUrl, experience.activitySlug)

  const difficulty = experience.difficulty ?? null
  const highlight = experience.highlight ?? null
  const ratingCount = experience.ratingCount ?? 0
  const showRating = ratingCount > 0
  const difficultyConfig = difficulty ? DIFFICULTY_BADGE[difficulty] : null

  // Issue #08 — opt-in wishlist heart. Rendered as an absolutely-positioned
  // overlay SIBLING of the Link (never nested inside the anchor, which would
  // be invalid HTML and would navigate on heart click). Only present when the
  // caller passes `isWishlisted` (logged-in surfaces); absent → unchanged card.
  const showWishlist = experience.isWishlisted !== undefined

  return (
    <div className="group relative">
      {showWishlist ? (
        <WishlistButton
          experienceId={experience.id}
          initialSaved={experience.isWishlisted ?? false}
          className="absolute right-2 top-2 z-10 px-2 py-1.5"
        />
      ) : null}
      <Link
        href={`/experience/${experience.slug}`}
        className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-sm)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:hover:translate-y-0"
      >
        <div className="relative aspect-[3/2] w-full overflow-hidden">
        <Image
          src={imageUrl}
          alt=""
          role="presentation"
          fill
          className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:group-hover:scale-100"
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
        />
        {/* Social-proof badge — top-left, ONLY on earned listings (sparse). */}
        {highlight ? (
          <div className="absolute left-2 top-2">
            {highlight === 'bestseller' ? (
              <Badge variant="warning" className="backdrop-blur-sm">
                <Flame aria-hidden="true" />
                {t('badges.bestseller')}
              </Badge>
            ) : (
              <Badge variant="info" className="backdrop-blur-sm">
                <Award aria-hidden="true" />
                {t('badges.topRated')}
              </Badge>
            )}
          </div>
        ) : null}

        {/* Difficulty pill — bottom-left, colour ALWAYS paired with label. */}
        {difficulty && difficultyConfig ? (
          <div className="absolute bottom-2 left-2">
            <Badge
              variant={difficultyConfig.variant}
              className={
                difficultyConfig.className
                  ? `backdrop-blur-sm ${difficultyConfig.className}`
                  : 'backdrop-blur-sm'
              }
            >
              {t(`difficulty.${difficulty}`)}
            </Badge>
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-[var(--space-card-pad)]">
        <span className="text-[0.625rem] font-semibold uppercase tracking-wider text-primary-strong">
          {activityLabel}
        </span>

        <h3 className="line-clamp-2 font-heading text-sm font-semibold leading-snug tracking-tight">
          {experience.title}
        </h3>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <MapPin className="size-3 shrink-0" aria-hidden="true" />
            {regionLabel}
          </span>
          {showRating ? (
            <span className="flex items-center gap-0.5 font-medium text-foreground">
              <Star
                className="size-3 shrink-0 fill-current text-warning"
                aria-hidden="true"
              />
              <span className="tabular-nums">
                {(experience.ratingAvg ?? 0).toFixed(1)}
              </span>
              <span className="text-muted-foreground tabular-nums">
                ({ratingCount})
              </span>
            </span>
          ) : null}
        </div>

        <Badge variant="success" className="self-start">
          <ShieldCheck aria-hidden="true" />
          {t('trustBadges.freeCancellation')}
        </Badge>

        <div className="mt-auto pt-1">
          <span className="text-sm font-bold tabular-nums text-foreground">
            ₹{experience.pricePerParticipantRupees.toLocaleString('en-IN')}
          </span>
          <span className="ml-1 text-xs text-muted-foreground">/ person</span>
        </div>
      </div>
      </Link>
    </div>
  )
}
