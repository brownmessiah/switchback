import type { TrustBadge } from './derive'

/**
 * Resolve a derived TrustBadge's `labelKey` to its translated label using a
 * STATIC, exhaustive map of literal message keys (no dynamic `t(\`...\`)`
 * keys — see .claude/agents/i18n-translator.md). The keys live under the
 * top-level `TrustBadges` message namespace so every surface (card, PDP)
 * resolves the same string.
 *
 * `t` is a next-intl translator. We accept the broad signature so this helper
 * works with both `useTranslations()` (client) and `getTranslations()` (server)
 * results without coupling to a namespace at the call site.
 */
type Translator = (key: string) => string

export function trustBadgeLabel(t: Translator, badge: TrustBadge): string {
  switch (badge.labelKey) {
    case 'verifiedVendor.identity':
      return t('TrustBadges.verifiedVendor.identity')
    case 'verifiedVendor.business':
      return t('TrustBadges.verifiedVendor.business')
    case 'safetyChecked':
      return t('TrustBadges.safetyChecked')
    case 'instantConfirmation':
      return t('TrustBadges.instantConfirmation')
    case 'partialPay':
      return t('TrustBadges.partialPay')
    case 'flexibleCancellation':
      return t('TrustBadges.flexibleCancellation')
    case 'beginnerFriendly':
      return t('TrustBadges.beginnerFriendly')
    default:
      // Exhaustive — every labelKey emitted by deriveTrustBadges is handled.
      return badge.labelKey
  }
}
