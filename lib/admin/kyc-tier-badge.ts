import {
  BuildingIcon,
  InfoIcon,
  PhoneIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from 'lucide-react'

/**
 * `kycTierBadge` — the Vendor KYC tier ramp for the `/admin/vendors` list.
 *
 * ADR-0007 defines three KYC tiers (phone → identity → business). Rendering all
 * three with the same green "verified" pill (the prior behaviour) loses the
 * ranking: a phone-tier Vendor (cannot publish) reads as equally "good" as a
 * Business-tier Vendor. This helper returns a distinct semantic variant + icon
 * + label per tier so the strongest tier is visually distinct, paired with text
 * + an icon so status is never conveyed by colour alone (DESIGN.md §1.3 / §5,
 * WCAG 1.4.1). Variants use the existing semantic Badge tokens.
 *
 * Pure — TDD'd in `kyc-tier-badge.test.ts`.
 */
export type KycBadgeVariant = 'success' | 'info' | 'warning' | 'outline'

export interface KycTierBadgeSpec {
  variant: KycBadgeVariant
  icon: LucideIcon
  label: string
}

const TIER_RAMP: Record<string, KycTierBadgeSpec> = {
  // Strongest tier — can publish + transact at full capability.
  business: { variant: 'success', icon: BuildingIcon, label: 'Business verified' },
  // Mid tier — identity-verified, distinct hue from business so the ramp reads.
  identity: { variant: 'info', icon: ShieldCheckIcon, label: 'Identity verified' },
  // Signup-only tier — phone-verified but CANNOT publish; lowest on the ramp.
  phone: { variant: 'warning', icon: PhoneIcon, label: 'Phone verified' },
}

export function kycTierBadge(tier: string): KycTierBadgeSpec {
  return TIER_RAMP[tier] ?? { variant: 'outline', icon: InfoIcon, label: tier }
}
