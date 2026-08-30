import Image from 'next/image'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Award, Flame, MapPin, Star } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { CompareToggle } from '@/components/compare/toggle'
import { TrustBadge } from '@/components/trust-badge'
import { WishlistButton } from '@/components/wishlist-button'
import { resolveExperienceCover } from '@/lib/media/experience-images'
import {
  deriveTrustBadges,
  type CancellationPreset,
  type KycTier,
  type PaymentMode,
} from '@/lib/trust-badges/derive'
import { trustBadgeLabel } from '@/lib/trust-badges/labels'

export interface ExperienceCardData {
  id: string
  slug: string
  title: string
  shortDescription?: string | null
  pricePerParticipantRupees: number
  /**
   * Lowest ACTIVE pricing-variation entry price in whole rupees (issue #08).
   * When present AND strictly below `pricePerParticipantRupees`, the card shows
   * "From ₹{fromPriceRupees} / person" instead of the plain base/bracket price.
   * Computed server-side via `fromPriceRupees`. Bracket-only experiences (no
   * active variations) omit it → the card renders EXACTLY as before.
   */
  fromPriceRupees?: number | null
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
   * Card tags (parity with switchback.com). All additive / nullable — a bare card
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
  /**
   * Trust-badge backing data (issue 05). All additive / optional — a card that
   * passes none renders only the universally-eligible Instant Confirmation
   * badge (ADR-0003). Each badge is data-honest: it appears ONLY when its
   * backing field is present (see lib/trust-badges/derive.ts). The card carries
   * its OWN vendorKycTier (already declared above) into the derivation.
   *
   *  - `cancellationPreset` — drives the Flexible-cancellation badge (ADR-0005).
   *  - `requiresSafetyStack` — drives the Safety Checked badge (ADR-0015).
   *  - `paymentModesAllowed` — drives the Partial Payment badge (ADR-0001).
   */
  cancellationPreset?: CancellationPreset | null
  requiresSafetyStack?: boolean | null
  paymentModesAllowed?: PaymentMode[] | null
}

interface ExperienceCardProps {
  experience: ExperienceCardData
  /**
   * Results-grid layout (search view toggle). `'grid'` (default) is the compact
   * vertical A1 tile; `'list'` is a horizontal row (image left, content right)
   * that additionally surfaces the short description — parity with switchback.com's
   * list view. Any caller that omits this gets the unchanged grid card.
   */
  layout?: 'grid' | 'list'
  /**
   * Compare toggle (issue 20, D10). Renders the "Compare" checkbox in the card
   * footer when `true` (the default — every discovery surface gets it). Pass
   * `false` to suppress it (e.g. an embedded card where comparing makes no
   * sense). Purely additive — the rest of the card is unchanged either way.
   */
  showCompare?: boolean
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
export function ExperienceCard({
  experience,
  layout = 'grid',
  showCompare = true,
}: ExperienceCardProps) {
  const t = useTranslations('HomePage')
  // Root translator for the shared TrustBadges namespace (the labels helper
  // passes fully-qualified `TrustBadges.*` keys so card + PDP share one source).
  const tRoot = useTranslations()
  const activityLabel = ACTIVITY_LABELS[experience.activitySlug] ?? experience.activitySlug
  const regionLabel = REGION_LABELS[experience.regionSlug] ?? experience.regionSlug
  const imageUrl = resolveExperienceCover(experience.coverImageUrl, experience.activitySlug)
  const isList = layout === 'list'

  const difficulty = experience.difficulty ?? null
  const highlight = experience.highlight ?? null
  const ratingCount = experience.ratingCount ?? 0
  const showRating = ratingCount > 0
  const difficultyConfig = difficulty ? DIFFICULTY_BADGE[difficulty] : null

  // "From ₹X" (issue #08): when an active pricing variation undercuts the base
  // price, advertise the lowest entry point. Only fires when fromPriceRupees is
  // present AND strictly cheaper than the base — equal/absent → plain price.
  const fromPrice = experience.fromPriceRupees ?? null
  const showFromPrice =
    fromPrice != null && fromPrice > 0 && fromPrice < experience.pricePerParticipantRupees
  const displayPriceRupees = showFromPrice ? fromPrice : experience.pricePerParticipantRupees

  // Data-honest trust badges (issue 05) — derived purely from this listing's
  // real data; a field that is absent simply omits its badge. "Popular Choice"
  // is NOT here — it is the social-proof `highlight` overlay above.
  const trustBadges = deriveTrustBadges({
    vendorKycTier: (experience.vendorKycTier ?? 'phone') as KycTier,
    requiresSafetyStack: experience.requiresSafetyStack ?? false,
    cancellationPreset: (experience.cancellationPreset ?? 'moderate') as CancellationPreset,
    difficulty,
    paymentModesAllowed: (experience.paymentModesAllowed ?? []) as PaymentMode[],
    basePriceRupees: experience.pricePerParticipantRupees,
  })

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
        className={
          isList
            ? 'flex flex-row overflow-hidden rounded-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-sm)] transition-all duration-200 hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50'
            : 'flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-card shadow-[var(--shadow-sm)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:hover:translate-y-0'
        }
      >
        <div
          className={
            isList
              ? 'relative aspect-[4/3] w-36 shrink-0 overflow-hidden sm:w-56'
              : 'relative aspect-[3/2] w-full overflow-hidden'
          }
        >
        <Image
          src={imageUrl}
          alt=""
          role="presentation"
          fill
          className="object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:group-hover:scale-100"
          sizes={
            isList
              ? '(max-width: 640px) 9rem, 14rem'
              : '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw'
          }
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

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-[var(--space-card-pad)]">
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

        {/* List layout surfaces the short description (parity with switchback
            list view); the compact grid tile keeps it hidden. */}
        {isList && experience.shortDescription ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {experience.shortDescription}
          </p>
        ) : null}

        {/* Data-honest trust badges (issue 05) — rendered via the shared
            TrustBadge component. Each appears ONLY when this listing's real
            data backs it; no hardcoded/decorative badge remains. */}
        {trustBadges.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {trustBadges.map((badge) => (
              <TrustBadge
                key={badge.id}
                id={badge.id}
                label={trustBadgeLabel(tRoot, badge)}
              />
            ))}
          </div>
        ) : null}

        <div className="mt-auto pt-1">
          {/* "From ₹X" (issue #08) — shown only when an active pricing variation
              is strictly cheaper than the base/bracket price, advertising the
              lowest entry point. Bracket-only listings render the plain price,
              unchanged. */}
          {showFromPrice ? (
            <span className="mr-1 text-xs text-muted-foreground">{t('from')}</span>
          ) : null}
          <span className="text-sm font-bold tabular-nums text-foreground">
            ₹{displayPriceRupees.toLocaleString('en-IN')}
          </span>
          <span className="ml-1 text-xs text-muted-foreground">/ person</span>
        </div>
      </div>
      </Link>
      {/* Compare toggle (issue 20, D10) — a SIBLING of the Link (never nested in
          the anchor, which would navigate on click). Guest-friendly, localStorage
          only, max 3. Suppressible via `showCompare={false}`. */}
      {showCompare ? (
        <div className="mt-1.5 px-[var(--space-card-pad)]">
          <CompareToggle slug={experience.slug} />
        </div>
      ) : null}
    </div>
  )
}
