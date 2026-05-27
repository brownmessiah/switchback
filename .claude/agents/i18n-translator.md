# i18n-translator Agent

Agent for enforcing i18n conventions when working on UI strings in Outvers.

## When to use

Invoke this agent when:
- Adding or modifying user-facing text in any component or page
- Creating new message keys or namespaces
- Translating strings to a new locale
- Reviewing code for i18n compliance
- Debugging locale resolution or language switching issues

## Hard rules

### DO

1. **Use `useTranslations()` from `next-intl` for client components**
   ```tsx
   import { useTranslations } from 'next-intl'

   function SearchPage() {
     const t = useTranslations('SearchPage')
     return <h1>{t('heading.default')}</h1>
   }
   ```

2. **Use `getTranslations()` from `next-intl/server` for server components**
   ```tsx
   import { getTranslations, setRequestLocale } from 'next-intl/server'

   export default async function SearchPage({ params }: Props) {
     const { locale } = await params
     setRequestLocale(locale)
     const t = await getTranslations({ locale, namespace: 'SearchPage' })
     return <h1>{t('heading.default')}</h1>
   }
   ```

3. **Use `{ id: message }` style definitions in JSON files**
   Message files live at `lib/i18n/messages/{locale}.json`. Keys are nested by
   namespace and use dot-notation within `useTranslations()`.
   ```json
   {
     "SearchPage": {
       "heading": {
         "default": "Explore experiences",
         "withQuery": "Results for \"{query}\""
       }
     }
   }
   ```

4. **Use pre-resolved label maps for status enums and dynamic values**
   ```tsx
   // CORRECT: Pre-resolved label map
   const statusLabels = {
     confirmed: t('status.confirmed'),
     pending: t('status.pending'),
     cancelled: t('status.cancelled'),
   } as const

   return <Badge>{statusLabels[booking.status]}</Badge>
   ```

5. **Run translation management scripts for all locale updates**
   - `pnpm i18n:check` — Validates all locale files have matching key sets (CI gate)
   - `pnpm i18n:missing` — Generates `.i18n-work/missing.json` with untranslated keys
   - `pnpm i18n:merge` — Merges translated keys from `.i18n-work/translated.json` into locale files

6. **Respect the locale resolution priority** (per ADR-0012)
   1. URL path prefix (middleware)
   2. `locale` cookie
   3. `Accept-Language` header
   4. Default locale (`en`)

7. **Keep `en.json` as the source-of-truth**
   All new keys must appear in `en.json` first. Other locale files mirror its
   structure. The `i18n:check` script enforces key parity.

8. **Use ICU message syntax for plurals and interpolation**
   ```json
   {
     "results": {
       "count": "{count} experience{count, plural, one {} other {s}} found"
     }
   }
   ```

### DON'T

1. **Never use `useExtracted` — that API does not exist in next-intl v4**
   ```tsx
   // WRONG: useExtracted is not a real API
   import { useExtracted } from 'next-intl'
   ```

2. **Never use dynamic translation keys**
   ```tsx
   // WRONG: Dynamic key — breaks static analysis and extraction
   const key = `status.${booking.status}`
   const label = t(key)

   // CORRECT: Pre-resolved map with static keys
   const labels = {
     confirmed: t('status.confirmed'),
     pending: t('status.pending'),
   }
   const label = labels[booking.status]
   ```

3. **Never manually edit locale files other than `en.json`**
   Non-English locale files (`hi.json`, `ta.json`, etc.) should be updated
   through the translation pipeline:
   1. Add keys to `en.json`
   2. Run `pnpm i18n:missing` to generate the missing-keys report
   3. Translate the missing keys (human or AI)
   4. Run `pnpm i18n:merge` to merge translations into locale files

4. **Never overwrite existing non-empty translations**
   The `i18n:merge` script enforces this — it rejects attempts to overwrite
   existing translations. If a correction is needed, manually edit the specific
   value in the locale file and document why.

5. **Never hardcode user-facing strings in components**
   ```tsx
   // WRONG: Hardcoded string
   return <h1>Search Experiences</h1>

   // CORRECT: Translated string
   const t = useTranslations('SearchPage')
   return <h1>{t('heading.default')}</h1>
   ```

6. **Never add locale prefixes to authenticated routes**
   Admin (`/admin/*`), vendor (`/vendor/dashboard`, `/vendor/listings`, etc.),
   customer dashboard (`/dashboard/*`, `/bookings/*`, `/checkout/*`), and API
   routes (`/api/*`) are excluded from i18n routing per `EXCLUDED_PREFIXES`
   in `lib/i18n/routing.ts`. These routes use cookie-based locale resolution
   instead.

7. **Never import from `lib/i18n/provider` in server components**
   The `IntlProvider` and `useIntl()` hook are client-only. Server components
   use `getTranslations()` and `getLocale()` from `next-intl/server`.

## File reference

| File | Purpose |
|------|---------|
| `lib/i18n/config.ts` | Locale constants, cookie helpers, type guards |
| `lib/i18n/routing.ts` | next-intl routing config, excluded prefixes |
| `lib/i18n/resolve-locale.ts` | Pure locale resolution logic (priority chain) |
| `lib/i18n/request.ts` | Server-side getRequestConfig for next-intl |
| `lib/i18n/provider.tsx` | Client-side IntlProvider + useIntl() hook |
| `lib/i18n/messages/en.json` | English source-of-truth messages |
| `lib/i18n/messages/hi.json` | Hindi translations |
| `lib/seo/hreflang.ts` | hreflang alternate link generation |
| `components/language-selector.tsx` | Language switcher component |
| `scripts/i18n-check.ts` | CI gate: validates key parity across locales |
| `scripts/i18n-missing-report.ts` | Generates missing-keys report |
| `scripts/i18n-merge-translations.ts` | Merges translated keys into locale files |
| `scripts/i18n-utils.ts` | Shared utilities for i18n scripts |

## Translation workflow

```
1. Add new keys to en.json
2. pnpm i18n:check        # Fails — missing keys in other locales
3. pnpm i18n:missing       # Generates .i18n-work/missing.json
4. Translate missing keys  # Human or AI, output to .i18n-work/translated.json
5. pnpm i18n:merge         # Merges translations into locale files
6. pnpm i18n:check        # Passes — all locales have matching keys
```
