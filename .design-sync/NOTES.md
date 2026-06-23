# design-sync NOTES — outvers-next → claude.ai/design

This repo is a **Next.js app**, not a packaged design system. The sync imports a
curated component surface (23 `components/ui` primitives + selected feature
components) into the Claude Design project **"outvers-next Components"**
(`projectId` in config.json). The original hand-authored **"Outvers Design
System"** project is a *separate, different-format* project — do not touch it.

## How the build is wired (not the converter's defaults)

- **No `dist/` / no package exports** → custom bundle entry `.design-sync/entry.tsx`
  re-exports exactly the curated set; passed via `--entry`. `componentSrcMap`
  enumerates the component LIST (names → src paths for `.d.ts` + docs). Do NOT
  rely on synth-entry auto-discovery (it would `export *` from every file in
  `components/`, dragging server/DB components into esbuild).
- **Path aliases + Next shims** live in `.design-sync/tsconfig.sync.json`
  (pointed at by `cfg.tsconfig`). The converter's tsconfigPathsPlugin reads its
  `paths` directly and does NOT follow `extends`, so all aliases are inlined.
  `next/image`, `next/link`, `next/navigation`, `next-intl`, `server-only` map
  to inert shims in `.design-sync/shims/` so client components bundle + render
  statically with no Next runtime. `next-intl`'s shim resolves real copy from
  `lib/i18n/messages/en.json`.
- **Tailwind v4 CSS**: `cfg.buildCmd = node .design-sync/build-styles.mjs`
  compiles `app/globals.css` (Tailwind v4 auto-scans the repo for classes) into
  `.design-sync/compiled-styles.css` (= `cfg.cssEntry`), then binds the
  `--font-*` vars (next/font sets these at runtime in the app) and pulls
  DM Sans + Bricolage Grotesque via a Google Fonts `@import`.
- Tailwind CLI is installed into the staged `.ds-sync/node_modules`
  (`@tailwindcss/cli@4.3.0`) — **not** a repo dep. On a fresh clone re-sync, the
  dep install line must include it.

## Re-sync risks (what can silently go stale)

- **Fonts are loaded via a remote Google Fonts `@import`** (DM Sans, Bricolage
  Grotesque, Noto Sans Devanagari), not self-hosted. Previews depend on network
  at render time and designs depend on it at runtime. Tailwind flags this
  `[FONT_REMOTE]` (informational). To harden: self-host woff2 + `@font-face` and
  point `cfg.extraFonts` at them.
- **next-intl shim** resolves `en.json` at bundle time — if a synced component's
  copy keys move namespaces, previews fall back to humanized keys (not broken,
  just generic). Re-check after large i18n refactors.
- **next/navigation + @/lib/i18n/provider** dependent components (search filters,
  language selector) render with inert router/locale state — interactions are
  inert in previews by design.
- The bundle is built from **live `components/` source** (no version pin); a
  refactor of any synced component changes the bundle on next sync.

## Top follow-up: weak .d.ts contracts (synth-entry)

Because there's no built `dist/` or shipped `.d.ts`, the converter emits loose
prop contracts (`{ [key: string]: unknown }`) per component. The design agent
gets real prop guidance from the authored preview examples in each
`.prompt.md`, but the typed `<Name>Props` is weak. To harden: either add a
`tsc --declaration --emitDeclarationOnly` build that emits real `.d.ts` and
point `--entry` at it, or hand-write the high-traffic ones via
`cfg.dtsPropsFor.<Name>`. Accepted as a v1 tradeoff.

## Preview authoring conventions (learned across waves)

- `import { X } from "outvers-next"` resolves EVERY synced export on the global
  (compose compounds + pull Button/Badge/Card freely). `toast` is re-exported
  from sonner via entry.tsx for the Toaster preview.
- **Layout glue = inline styles only** — Tailwind classes invented in a preview
  are NOT in the compiled CSS (Tailwind only emits classes found in repo
  source). Colors via CSS vars: `--primary`, `--foreground`,
  `--muted-foreground`, `--border`, `--card`, `--background`, `--success`,
  `--muted`, `--radius-control`. Components carry their own styling.
- **Overlays** (Dialog/Sheet wrap base-ui `Dialog.Root`): render the open state
  with **`defaultOpen`**. **Tooltip**: wrap in `<TooltipProvider>` + force
  **`open`**. The pre-set `cardMode:single` + viewport overrides capture the
  portaled content — no further config needed.
- **Pre-translated labels**: `BookingStatusBadge {state,label}` and
  `TrustBadge {id,label}` do NOT derive their text — pass `label` explicitly.
- `ReviewStars {rating,max?}` fills with integer `i < rating` (no half-star) —
  use whole numbers, show decimals as adjacent text.
- `EmptyState {icon,title,description?,cta?}` — `icon` is a lucide COMPONENT
  (`import { Heart } from "lucide-react"` compiles fine in previews).
- Accordion `defaultValue` is an ARRAY of item values; Tabs `defaultValue` a
  string; both keyed by `value`.
- Full-width states (EmptyState/Dashboard/Search) read best at
  `{ maxWidth: 520, margin: "0 auto" }`.

## Prop contracts (read from source — emitted .d.ts are loose stubs)
- **ResponsiveTable** — NOT composable: `{columns:[{key,header,primary?,align?,cell?}], rows, getRowKey, rowHref, caption}`. Renders its own Card>Table shell at md+.
- **CompareToggle** `{slug, className?}` — checked derives from localStorage (unchecked at rest).
- **ActiveFilterChips** `{parsed: SearchExperiencesParams}` — supply region/activity/difficulty/minPrice/maxPrice/minRating/safetyVerified/cancellation/category etc.; empty parsed → null.
- **ViewToggle** `{current:'grid'|'list', gridLabel, listLabel}` (labels pre-translated by caller).
- **LanguageSelector** `{variant:'compact'|'full', className?, onDark?}` — dropdown is interaction-gated (closed at rest is the correct resting visual).
- **HomeHowItWorks / HomeTrust** — no props (copy from useTranslations).
- **RecentlyViewedRail** `{fetchCards, contained?}` — gated on localStorage slugs; the preview seeds `outvers-recently-viewed` at module scope to render.
- Overlays (Select/DropdownMenu/Dialog/Sheet) render open via `defaultOpen` on the base-ui Root; Tooltip via `<TooltipProvider>` + `open`.
- Table/ResponsiveTable: per-cell alignment via inline `style` (`textAlign`/`fontVariantNumeric`) — `text-right tabular-nums` only compile if used in repo source.

## Floor-carded by design
- **Toaster** — sonner's toast region has NO static visual; toasts portal to the
  viewport corner and don't survive a static screenshot. Two render attempts
  (mounting the region + firing toasts) captured blank, so Toaster ships the
  honest floor card. Not a defect — it's infrastructure.

## Known render warns (triaged benign — re-syncs should expect these)
- **Dialog**, **Sheet** — `[RENDER_THIN]` "rendered height is 0px": these overlays
  portal/fixed-position their content, so the card ROOT measures 0 while the
  portaled DialogContent/SheetContent render fine. Screenshots confirmed good
  (open dialog with backdrop; open side sheet). Benign — do not rework.
- **Progress**, **Textarea** — were `[GRID_OVERFLOW]`; resolved with
  `cardMode: column` overrides (full card width per story). Won't re-flag.
