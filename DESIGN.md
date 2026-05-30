# DESIGN.md — Outvers Design System

**Status: FINAL (2026-05-30).** This is the single design source of truth for the Outvers
redesign. It supersedes the staged working notes (`06-codify.md` as-is inventory,
`07-foundations.md` foundations spec, `08-flows.md` pattern contract); where any of those
disagree with this document, **this document wins**, and where the as-is conflicts with the
foundations/flows decisions, **the foundations/flows decisions are final**.

The redesign **extends** the existing stack — it does not replace it. Tailwind v4
(`@import "tailwindcss"` + `@theme inline` bridge), Base UI / shadcn primitives
(`@base-ui/react/*`, `components/ui/*`), `tw-animate-css`, the OKLCH color space, and
`next/font` (DM Sans + Noto Sans Devanagari) are all retained. Every token name that exists
today keeps its name; we **re-value** some tokens and **add** new token families. No framework
swap, no font-loader swap, no OKLCH change, no primitive-API break.

Domain language is used verbatim per `CONTEXT.md`: **Experience**, **Vendor**, **Customer**,
**Booking**, **Availability slot**, **Wallet**, **Outvers credit**, **Refund balance**,
**Group-size bracket**, **Combo Experience**, **Identity verified Vendor**, **Business verified
Vendor**, **Advance**, **Partial pay**, **Commission**, **Required permit**, **TripGroup**.
**RNPL caveat:** "Reserve now, pay later" is schema-named but **not implemented in v1**; the live
analog is **Partial pay** (25% Advance now, 75% auto-captured at T-24h). Never render an RNPL tile.

---

## 1. Overview & principles

### 1.1 Brand identity

**"Classic Coral"** — a single coral brand hue (`#FF385C`-family) on a warm-neutral surface ramp,
expressed entirely in **OKLCH**. The brand is correct and recognizable; this redesign **refines,
not rebrands**. Coral remains the one brand color; everything else upgrades around it.

### 1.2 What the design must do (intent)

The redesign exists to win on **trust and money-correctness** in the India experiences market. The
foundations and patterns are built to serve five jobs, each derived from competitor research and
the Outvers domain:

1. **Trust is legible at a glance.** Every card/row/module is *decision-complete*: rating, price,
   cancellation token, status, and verified-Vendor signal are visible before the click. This
   requires a **semantic-status color family** the as-is system never had (it had only coral +
   `destructive`).
2. **Dense, scannable, decision-complete surfaces** (search results, collection grids, vendor/admin
   tables) need a tighter spacing rhythm, a true small/caption type tier, and **tabular numerics**.
3. **Long, scrollable PDPs and policy pages** need a clear heading hierarchy distinct from body and
   a capped reading measure, plus sticky in-page anchor navigation.
4. **Money & refunds are shown visually, before commit.** Prices, refund slabs, and the two-bucket
   Wallet (Outvers credit + Refund balance) render the exact figure and split *before* the Customer
   confirms — tabular figures + status colors mapped to wallet buckets.
5. **India-first, multi-script** (ADR-0012: en + hi at launch; ta/mr/bn to follow). Foundations hold
   across Latin and Devanagari (and future Tamil/Bengali) without per-page line-height re-tuning.

### 1.3 Cross-cutting principles (apply to every component & pattern)

1. **Decision-complete surfaces.** Every card/row/module shows enough to act without a further
   click: rating · price · cancellation token · status.
2. **Status never by color alone.** Every status token ships with a paired lucide icon
   (check / clock / info / wallet / alert). WCAG 1.4.1 + a redundancy cue for low-end displays.
3. **Money is tabular and shown before commit.** Prices, Group-size bracket counts, refund slabs,
   and Wallet balances use `.tabular-nums`; the exact refund/charge is rendered before the Customer
   confirms.
4. **One feedback vocabulary per surface.** A surface shows exactly one of {empty, error, loading,
   content} at a time; skeletons mirror the eventual content layout (zero layout shift).
5. **Reduced-motion + focus are foundational, not per-component.** A global
   `prefers-reduced-motion` block and `focus-visible:ring-3 ring-ring/50` apply everywhere; patterns
   never re-implement them.

### 1.4 Implementation rule

Everything below is implementable as **additive tokens and CVA variants** on the existing stack.
The only files that change for the foundation layer are `app/globals.css` (tokens + base layer)
and `app/layout.tsx` (heading font). New components (Alert/Banner, composed blocks) are
compositions of the existing 20 primitives + the new tokens.

---

## 2. Foundations (the final token system)

All values OKLCH, defined once in `:root` (light) and re-valued in `.dark`, bridged to Tailwind
utilities via `@theme inline`. The as-is system was tokenized only for **color** and **radius**;
this system adds **type scale, spacing, shadow, and motion** token families and a
**semantic-status color family**.

### 2.1 Color

#### Brand (kept)

| Token | Light | Dark | Role |
|---|---|---|---|
| `--primary` | `oklch(0.55 0.23 17)` | `oklch(0.78 0.16 17)` | Coral brand — **fills only** (white text on coral) |
| `--primary-foreground` | `oklch(1 0 0)` | `oklch(0.15 0.01 30)` | Text on coral fill |
| `--primary-strong` *(new)* | `oklch(0.50 0.21 19)` | `= --primary` | Coral **as foreground**: link text, ghost-button labels, small icons, `--ring` binding (clears AA ≥4.5:1 on light) |
| `--accent` | `= --primary` | `= --primary` | (kept; identical to primary) |

`--primary` and `--accent` remain identical — coral is the single brand color.

#### Neutral surface ramp (new — unifies on the warm coral-grey axis, hue ≈ 30)

The as-is mixed a warm-neutral surface (hue 30/60) with cool-slate text/borders (hue 250), which
read as a subtle clash and muddied elevation. **Decision: unify all neutrals on hue ≈ 30** and add
an explicit elevation ramp.

| Token | Light | Dark | Role |
|---|---|---|---|
| `--surface-0` | `oklch(1 0 0)` | `oklch(0.14 0.004 30)` | App background (aliased by `--background`) |
| `--surface-1` | `oklch(0.985 0.004 30)` | `oklch(0.165 0.005 30)` | Raised card (aliased by `--card`) |
| `--surface-2` | `oklch(0.97 0.005 30)` | `oklch(0.195 0.006 30)` | Popover / dropdown / sheet (aliased by `--popover`) |
| `--surface-3` | `oklch(0.955 0.006 30)` | `oklch(0.225 0.006 30)` | Sticky booking module / overlay header |
| `--border` *(re-hued)* | `oklch(0.92 0.004 30)` | `oklch(0.255 0.006 30)` | Was hue 250 → now warm 30 |
| `--input` *(re-hued)* | `oklch(0.92 0.004 30)` | `oklch(0.255 0.006 30)` | Was hue 250 → now warm 30 |
| `--muted-foreground` *(re-hued + darkened)* | `oklch(0.46 0.012 30)` ≈ 5.6:1 | `oklch(0.72 0.012 30)` | Was `oklch(0.5 0.01 250)` ≈ 4.6:1 (borderline) → darkened for AA headroom |

`--background`, `--card`, `--popover` stay as **aliases** of the new `--surface-*`, so existing
components keep working unchanged.

#### Semantic status family (new — the headline upgrade)

The as-is had exactly one brand color + `destructive`, so there was no token for "free
cancellation", "instant confirmation", "verified Vendor", "Outvers credit", or urgency. Five
functional roles, each with a saturated **base**, a **foreground** (text on the base), and a
**subtle tint** (chip/banner fills) — mirroring the existing `--primary` / `--primary-foreground`
contract so CVA variant additions are mechanical.

| Role | Token (base) | Light base | Dark base | Maps to (domain / competitor) |
|---|---|---|---|---|
| **success / affirmative** | `--success` | `oklch(0.58 0.13 155)` | `oklch(0.72 0.15 155)` | Free cancellation, instant confirmation, Booking `confirmed`, **Identity/Business verified Vendor** dot |
| **warning / caution** | `--warning` | `oklch(0.70 0.15 75)` | `oklch(0.80 0.15 80)` | Urgency ("Likely to sell out"), `awaiting_completion`, balance-due-soon, region-closed |
| **info / neutral-accent** | `--info` | `oklch(0.58 0.14 250)` | `oklch(0.72 0.13 250)` | Partial-pay schedule notice, ranking-disclosure ("How we rank") callout |
| **credit / wallet** | `--credit` | `oklch(0.60 0.14 300)` | `oklch(0.74 0.13 300)` | **Outvers credit** bucket, voucher refunds (distinct from cash) |
| **danger** *(kept)* | `--destructive` | `oklch(0.577 0.245 27.3)` | `oklch(0.704 0.191 22.2)` | Cancellation fee, declined verification, errors |

Each role also defines `--<role>-foreground` (`oklch(1 0 0)` light; near-black dark) and a subtle
tint `--<role>-subtle` (e.g. `--success-subtle: oklch(0.96 0.03 155)` light / `oklch(0.22 0.04 155)`
dark) for chip/banner fills.

#### Charts & sidebar (kept)

`--chart-1..5` and the `--sidebar-*` set are retained verbatim. Chart-1 is coral; charts 2–5 are
theme-invariant. (Chart-1 should track `--primary` where re-used.)

#### Token wiring

Add `@theme inline` bridges mirroring the existing pattern — `--color-success: var(--success)`,
`--color-success-subtle: var(--success-subtle)`, `--color-warning`, `--color-info`, `--color-credit`,
`--color-primary-strong`, `--color-surface-0..3` — yielding `bg-success`, `text-success`,
`bg-success-subtle`, `text-primary-strong`, `bg-surface-2`, etc. Zero new tooling.

### 2.2 Typography

**Body/UI: DM Sans (kept).** **Headings/display: a distinct display grotesque** — **Bricolage
Grotesque** (fallbacks: Clash Display / Familjen Grotesque) via `next/font/google`, bound to
`--font-heading`. This **replaces** the as-is `--font-heading = var(--font-sans)` aliasing, which
produced no hierarchy. Mono: the system mono stack (kept).

**Multi-script rule (the one hard constraint):** the display face is a **Latin enhancement, never
the source of truth for Indic scripts.** For `hi` (and future `ta`/`bn`/`mr`), `--font-heading`
resolves to `var(--font-devanagari), var(--font-sans)` via the per-locale `html[data-locale]`
conditional already in `layout.tsx`. Adding ta/mr/bn = a font import + a `data-locale` branch, no
foundation change (ADR-0012).

#### Type scale (new — modular, 1.20 minor-third for UI density, 1.25 step at the top for display)

Tokens under `@theme inline` (generate `text-*` utilities; size + line-height pairs):

| Token | Size (rem / px) | Line-height | Tracking | Intended use |
|---|---|---|---|---|
| `--text-display` | `3.0rem / 48` | `1.05` | `-0.02em` | Marketing-landing hero H1, 404/error |
| `--text-h1` | `2.25rem / 36` | `1.1` | `-0.015em` | PDP / collection / page H1 |
| `--text-h2` | `1.75rem / 28` | `1.2` | `-0.01em` | Section headers (Highlights, Reviews) |
| `--text-h3` | `1.375rem / 22` | `1.25` | `-0.005em` | Sub-section, card-cluster titles |
| `--text-lg` | `1.125rem / 18` | `1.5` | `0` | Lead paragraph, empty-state primary line |
| `--text-base` | `1.0rem / 16` | `1.6` | `0` | Body copy, prose (measure-capped) |
| `--text-sm` | `0.875rem / 14` | `1.5` | `0` | UI default, card title, table cell, form label |
| `--text-xs` | `0.8125rem / 13` | `1.45` | `0.005em` | Captions, "/ person", review meta, table sub-label |
| `--text-2xs` | `0.6875rem / 11` | `1.4` | `0.02em` | Badges, overline/eyebrow, legal microcopy |

- **Measure cap:** add `--measure: 68ch` + a `.prose`/content-width utility so PDP descriptions and
  the dated, ToC-structured Cancellation & Refund page stay in the 45–75ch readable band.
- **Body line-height 1.6** is deliberately generous — Devanagari matras need vertical room.
- **Display/heading line-heights are tight (1.05–1.25) + negative tracking** for the compact,
  confident H1 + "★ 4.9 · 4,018 reviews" stack the competitor PDPs use.
- **Weights (tokenized intent):** `--font-weight-normal: 400`, `--font-weight-medium: 500`,
  `--font-weight-semibold: 600`, `--font-weight-bold: 700`. Headings 600–700 (display face); body
  400; UI emphasis/labels 500.
- **Eyebrow tracking:** `--tracking-eyebrow: 0.12em` — the uppercase magazine-style eyebrow/overline
  on editorial landing pages wants wider tracking than the default `--text-2xs` `0.02em`. Apply as
  `text-2xs uppercase tracking-[var(--tracking-eyebrow)]`; never an off-system literal.

#### Tabular numerics (money-path requirement)

Add a `.tabular-nums` / `tnum` convention (`font-variant-numeric: tabular-nums`) applied to: prices
(`₹{…}`), Group-size bracket counts, review counts/ratings, refund-slab percentages (25/50/100%),
**Wallet** balances (Outvers credit + Refund balance), and any column of figures. DM Sans supports
tabular figures — a feature flag, not a font swap.

### 2.3 Spacing

The as-is had **zero custom spacing tokens** (raw Tailwind inline), causing density drift between
the two card idioms. Tailwind v4's default scale is already 4px-based; **keep it** (no relayout
churn) and add a thin layer of **semantic spacing aliases** so redesign components reference intent.

| Token | Value | Use |
|---|---|---|
| `--space-card-pad` | `1rem (16)` | Card body padding (unifies the two card idioms) |
| `--space-card-gap` | `0.75rem (12)` | Internal stack gap in a card |
| `--space-section` | `2.5rem (40)` mobile / `4rem (64)` ≥md | Vertical rhythm between PDP/landing sections (anchor scroll targets) |
| `--space-grid-gap` | `1rem (16)` mobile / `1.5rem (24)` ≥lg | Card-grid gutter (collection / search results) |
| `--space-field` | `0.5rem (8)` | Label→input gap |
| `--space-control-x` | `0.75rem (12)` | Horizontal padding inside default-size buttons/inputs |

### 2.4 Radius (kept mechanism — the strongest part of the as-is — + semantic aliases)

Keep `--radius: 0.75rem` and the `calc()`-derived ladder verbatim:

| Token | Definition | Resolved |
|---|---|---|
| `--radius` | `0.75rem` | 12px |
| `--radius-sm` | `calc(var(--radius) * 0.6)` | 0.45rem |
| `--radius-md` | `calc(var(--radius) * 0.8)` | 0.6rem |
| `--radius-lg` | `var(--radius)` | 0.75rem |
| `--radius-xl` | `calc(var(--radius) * 1.4)` | 1.05rem |
| `--radius-2xl` | `calc(var(--radius) * 1.8)` | 1.35rem |
| `--radius-3xl` | `calc(var(--radius) * 2.2)` | 1.65rem |
| `--radius-4xl` | `calc(var(--radius) * 2.6)` | 1.95rem |

**Add semantic aliases** (naming the intents the as-is expressed by coincidence; no value change):
- `--radius-card = var(--radius-xl)` (≈1.05rem) — standardizes both card idioms on one rounding.
- `--radius-control = var(--radius-lg)` — buttons/inputs.
- `--radius-pill = 9999px` — badges, status chips (formalizes the `rounded-4xl` pill convention).

### 2.5 Shadow / elevation (new — tiered system; surface-led in dark)

The as-is had **no shadow tokens** — it mixed raw `shadow-sm/md/lg` with a `ring-1
ring-foreground/10` hairline, and the two card idioms disagreed. Add a named, tiered system.

| Token | Light value | Dark strategy | Use |
|---|---|---|---|
| `--shadow-xs` | `0 1px 2px oklch(0 0 0 / 0.05)` | none; `--surface-1` + `--border` | Resting card, input |
| `--shadow-sm` | `0 1px 3px oklch(0 0 0 / 0.07), 0 1px 2px oklch(0 0 0 / 0.04)` | `--surface-1` + 1px border | Card resting |
| `--shadow-md` | `0 4px 12px oklch(0 0 0 / 0.08), 0 2px 4px oklch(0 0 0 / 0.05)` | `--surface-2` + border | Card hover-lift, dropdown |
| `--shadow-lg` | `0 12px 28px oklch(0 0 0 / 0.12), 0 4px 8px oklch(0 0 0 / 0.06)` | `--surface-2` + stronger border | **Sticky booking module**, sheet, dialog |
| `--shadow-popout` | `0 16px 40px oklch(0 0 0 / 0.16)` | `--surface-3` + border | Modal / tooltip popout |

- **Unified convention:** cards use `--shadow-sm` resting → `--shadow-md` on hover-lift (keep the
  `motion-reduce` guard). Overlays (dialog/sheet/popover) use `--shadow-lg`/`--shadow-popout`
  **layered on `--surface-2/3`** + keep the `ring-1 ring-foreground/10` hairline as the border layer.
- **Dark mode:** shadows are intentionally minimal; elevation is carried by the surface ramp +
  hairline border (drop shadows are near-invisible on near-black).

### 2.6 Motion (new — named durations + easings; global reduced-motion contract)

The as-is had **no motion tokens** (inline `duration-100/150/200/500` + `tw-animate-css`) and only
the card hover-lift had a `motion-reduce` guard. Add a small, named set so everything moves with one
personality, and make reduced-motion a system-wide rule.

**Durations**

| Token | Value | Use |
|---|---|---|
| `--duration-fast` | `120ms` | Hover, focus ring, button press, color/opacity |
| `--duration-base` | `200ms` | Dropdown/select/tooltip enter-exit, accordion, tab switch |
| `--duration-slow` | `320ms` | Dialog/sheet enter-exit, sticky-module reveal |
| `--duration-deliberate` | `500ms` | Money moments: refund-quote reveal, Wallet balance count-up |

**Easings**

| Token | Value | Use |
|---|---|---|
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Most enter/move (decelerate-in) |
| `--ease-emphasized` | `cubic-bezier(0.3, 0, 0, 1)` | Dialog/sheet, attention moments |
| `--ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | Exits / dismissals (accelerate-out) |
| `--ease-in-out` *(kept)* | existing default | Hover / color toggles |

Map onto `tw-animate-css` (keep `animate-in/out`, `fade-in-0`, `zoom-in-95`, `slide-in-from-*`,
`animate-accordion-*`); drive their timing from these tokens — no keyframe rewrite.

**Global reduced-motion contract** (replaces the single per-component guard):

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

Translate/scale *movement* (hover-lift, slide-ins) collapses to a fade or no-op; opacity/color may
remain. WCAG 2.3.3.

### 2.7 Token delta vs as-is (≈73 tokens today)

| Category | Change |
|---|---|
| Color | +`--surface-0..3`, +`--primary-strong`, +5 status roles × ~3 derived ≈ **+20**; `--border`/`--input`/`--muted-foreground` re-hued to warm 30 |
| Typography | **+9 `--text-*`** (size+LH), +4 `--font-weight-*`, +`--measure`, +display font, +`.tabular-nums` |
| Spacing | **+6 `--space-*`** semantic aliases (over the kept 4px scale) |
| Radius | **+3 semantic aliases** (`-card`/`-control`/`-pill`); `calc()` ladder unchanged |
| Shadow | **+5 `--shadow-*`** tiers (from 0) |
| Motion | **+4 `--duration-*`, +3 `--ease-*`** + global reduced-motion contract (from 0) |

---

## 3. Components & primitives

The 20 Base UI / shadcn primitives in `components/ui/*` are **retained**. All are `cn()` + CVA
where variants exist, tagged with `data-slot`, lucide icons throughout.

| # | Primitive | Use |
|---|---|---|
| 1 | Accordion | Collapsible disclosure (FAQ, PDP know-before) |
| 2 | Avatar | User/Vendor image + initials fallback; group/overflow variants |
| 3 | Badge | Status pill (`--radius-pill`); **status CVA variants added** (success/warning/info/credit) |
| 4 | Breadcrumb | Hierarchical nav trail |
| 5 | Button | Primary action; CVA variants + sizes; active nudges `translate-y-px` |
| 6 | Card | Content container — **unified contract** (`--radius-card`, `--surface-1`, `--shadow-sm`) |
| 7 | Dialog | Centered modal for interrupting *decisions* |
| 8 | DropdownMenu | Action/context menu |
| 9 | Input | Single-line field; `--radius-control`, focus ring 3px, aria-invalid treatment |
| 10 | Label | Form field label |
| 11 | Progress | Linear progress (wizard step completion) |
| 12 | RadioGroup | Single-select (payment mode, options) |
| 13 | Select | Dropdown select (sort, slot, filters) |
| 14 | Separator | Divider |
| 15 | Sheet | Edge drawer for *contextual side tasks* |
| 16 | Skeleton | Loading placeholder (layout-mirroring) |
| 17 | Table | Data table (admin/vendor lists) |
| 18 | Tabs | Tabbed nav (anchor nav, calendar⇄manifest toggle, wizard stepper) |
| 19 | Textarea | Multi-line field |
| 20 | Tooltip | Hover hint (inverted popup) |

**New components to build (additive — compositions / CVA, not new frameworks):**

- **Alert / Banner** *(net-new component, built from the same CVA + status tokens — the as-is has no
  alert primitive)*: used for form-error summary, ranking-disclosure ("How we rank", `--info`),
  money-path errors, and honest-constraint notices.
- **Badge status variants:** `success / warning / info / credit` added to the existing `badge` CVA.

**Cross-cutting primitive conventions (kept):** `data-slot` on every primitive;
`focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50` (with `--ring` now bound
to `--primary-strong`); `aria-invalid:border-destructive aria-invalid:ring-3 ring-destructive/20`;
`disabled:opacity-50` + `pointer-events-none`. Overlay surfaces share `ring-1 ring-foreground/10`
**now paired with `--shadow-lg`/`--shadow-popout`** + `--surface-2/3`.

---

## 4. Canonical patterns

The reusable building blocks. Each: when to use · anatomy (on the real primitives + §2 tokens) ·
states · accessibility · friction goal. **Core component patterns (A) and marketplace flow patterns
(B).**

### A1. Card

**Use** for one discrete object (Experience tile, Booking summary, Wallet bucket, Vendor metric).
**Resolves the as-is two-idiom split** (`ui/card` ring-edge vs bespoke `experience-card`
border+shadow) by standardizing one contract: `--radius-card`, `bg-surface-1`, `--shadow-sm`
resting, `--space-card-pad`/`--space-card-gap`. Slots: `CardHeader` (+optional `CardAction`) →
`CardTitle` (`--font-heading`) + `CardDescription` (`--text-xs muted`) → `CardContent` →
`CardFooter`. **Status-overlay slot:** one `Badge` (verified-Vendor dot / Free-cancellation /
urgency) — color **+ icon**, never color alone. Media variant: leading image auto top-rounds.
**States:** resting · hover-lift (`-translate-y-0.5` + `--shadow-md`, `--duration-fast`,
`motion-reduce` → opacity) · focus-within (ring on the inner link) · selected (`ring-2
ring-primary-strong`) · sold-out (`opacity-60` + `--warning`/`--destructive` badge) · loading
(Skeleton mirror). **A11y:** whole-card-link wraps one `<a>` named by the title; decorative image
`alt=""`. **Friction goal:** decision-complete tile pre-qualifies before the click.

### A2. Form (validation + error display)

**Use** for any data entry (sign-in, checkout identity, Vendor listing fields, Trusted-contact,
Dispute). Field unit: `--space-field` gap → `Label htmlFor` → control (`h-8 rounded-[--radius-control]`
+ `focus-visible:ring-3`) → helper/error slot; `space-y-4` between fields; sections split by
`Separator` + `--text-h3` header. **Submit upgrade:** add a real leading **spinner** affordance
(as-is swapped label text only), preserving the text swap as the accessible-name change.
**Validation upgrade:** inline field-level on **blur + submit** (`<p role="alert"
text-xs text-destructive>` + `aria-describedby`, sets `aria-invalid`); **form-level summary** Alert
(`--destructive-subtle`) listing errors as in-page anchors, focus moves to it on failed submit;
**success** feedback uses `--success-subtle` + check. **States:** default · focus · filled · invalid
· submitting · form-error · success. **A11y:** programmatic `Label`; `role="alert"` +
`aria-describedby`; required marked in text; focus management; 44px min touch targets.

### A3. Data table

**Use** for admin/vendor list surfaces with many homogeneous rows (**not** marketplace discovery —
that's the Card grid). `Card > CardContent p-0 > Table`, horizontal-scroll; page header `--text-h1`
+ `--text-xs muted` count subtitle; `TableHead` left-aligned + **sortable heads** (chevron +
`aria-sort`); rows hover `bg-muted/50`. **Status cells = one mapped `Badge`** via `STATE_VARIANTS`
re-pointed to the new tokens: `confirmed → success`, `awaiting_completion → warning`, `cancelled_*
→ destructive`, `pending/balance-due → info`, refund-to-credit → `credit`. **Numeric columns**
(amounts, Commission, TDS, payout, Group-size bracket counts) **right-aligned + `.tabular-nums`**.
Toolbar: filter chips + search + count + Clear; bulk-action bar on selection. Row → `…/[id]` detail.
**A11y:** `<caption>` (visually-hidden ok), `scope="col"`, `aria-sort`, labelled bulk-select, focusable
scroll region.

### A4. Dialog vs Sheet (overlay decision rule)

**Dialog** = short, focused, interrupting **decisions** (confirm cancellation, confirm payout,
destructive admin actions, **live refund-quote confirmation**). **Sheet** = **contextual side
tasks** that keep page context (mobile filter panel, Booking quick-view, mobile order-summary).
Both: overlay (`bg-black/10` + backdrop-blur) + `--surface-2/3` + `ring-1` hairline **paired with
`--shadow-lg`/`--shadow-popout`** (no longer the bare ring) + Header → body → Footer. Dialog:
zoom+fade (`--duration-slow`, `--ease-emphasized`). Sheet: slide+fade (default right; bottom on
mobile). **A11y:** focus trap + restore; `Esc` closes (unless destructive op mid-flight);
destructive confirm is the **non-default focus**.

### A5. Empty state

**Use** when a surface loads with zero items. **Block form:** centered `py-16`, a muted lucide icon
in a `bg-muted` circle (the missing visual the as-is lacked) → `--text-lg` primary line → `--text-xs`
helper → a **primary CTA** ("Browse Experiences", "Create your first listing"). **In-table form:**
one centered `TableCell colSpan`. **Filtered-empty variant:** "Clear filters", distinct from
genuinely-zero. **All strings via `next-intl`** (fixes the as-is hardcoded-English drift). **Friction
goal:** empties are next-action launchpads, not dead ends.

### A6. Error state

**Use** when an operation failed. **Page-level** (route boundary / 404): centered `min-h-[60vh]`,
`--text-display`/`--text-h1`, muted body, primary recovery `Button` (`reset()` / back-home) — **all
strings via `next-intl`** (fixes the as-is `error.tsx` hardcoded English). **Inline/section-level:**
an Alert block (`--destructive-subtle`, `role="alert"`) scoped to the failed region, with retry.
**Field-level:** A2 inline helper. **Money-path errors get explicit honest copy** (never generic),
e.g. "Advance capture failed — your slot is held for 30 min; retry payment." **States:** recoverable
· non-recoverable (route-to-support + reference id) · not-found. Errors never auto-dismiss; no
sensitive detail leaked.

### A7. Loading / skeleton

**Use** for any async wait. **Route/section skeleton mirrors the real layout** (grid template + card
aspect) → **zero CLS on hydrate** (keeps the as-is layout-mirroring discipline). **Inline action
loading:** button spinner + disabled (A2). **Optimistic + skeleton split:** instant feedback (slot
select highlights, `--duration-fast`) while the dependent number (price breakdown, refund quote)
shows a small skeleton then a **`--duration-deliberate` reveal** — the "money moment". `animate-pulse`
suppressed under reduced-motion (global rule). **A11y:** `aria-busy="true"` + visually-hidden
"Loading…"; `aria-live="polite"` on the region receiving the resolved money figure.

### B1. Search → Filter → Results

**Use** for `search-results` and `collection` surfaces. **Search hero** (one prominent autocomplete
`Input` + rotating hints). **Filter rail (desktop) / filter Sheet (mobile):** Klook-grade facets —
result-type tabs (Experience type / Combo Experience), price-range, Dates (Today/Tomorrow/All),
**Instant confirmation** toggle, Availability (region-closure-aware), location, **KYC-tier facet
(Identity / Business verified Vendor)**, active-filter count + Clear. **Sort `Select`:** Recommended
/ Lowest price / Most booked / Top rated / Recently added. **Results = Card grid (A1)** at
`--space-grid-gap`, each card decision-complete (badge · city+format · duration+perks · ★rating +
review count · per-person vs per-Group-size-bracket price `.tabular-nums` · Free-cancellation token).
**MANDATORY ranking-transparency disclosure** ("How we rank") inline near the count, `--info` Alert.
Provider rating surfaced (distinct from per-Experience rating; feeds B8). Numeric pagination.
**States:** loading · results · zero-after-filter (A5 + Clear) · error (A6 section-scoped, filters
stay live) · region-closed items shown with `--warning`, not hidden.

### B2. Experience-detail layout order

**Use** for the Experience PDP (incl. Combo Experiences). Canonical single-long-scroll order with
Viator-style sticky anchor nav:
1. Breadcrumb → **H1** (`--text-h1`, display face).
2. Rating + verified-review-count under the title + **Vendor attribution** (→ B8) + **Identity/
   Business verified Vendor badge** (`--success` + icon).
3. **Sticky in-page anchor nav** (Overview · Includes · Meeting point · Cancellation · Reviews),
   anchors landing on `--space-section` targets.
4. Gallery → one-line value prop.
5. **Assurance row:** Free-cancellation (explicit window + full-refund wording) · **Partial pay**
   (25% Advance now, balance at T-24h — *not* an RNPL badge) · validity · **Required permit** notice
   (links to official process; Outvers is not the broker) · accessibility.
6. **Reviews teaser (HIGH)** — verified-Booking snippets above the description.
7. Highlights → Full description → Includes + explicit exclusions.
8. **Price-transparency block:** per-participant base · **Required permit/fee** · service portion
   (Outvers permit + Commission + GST/TDS money path).
9. Meeting point (map deep-link) → Know-before-you-go.
10. **Booking module (B3)** — restates Free-cancellation + Partial-pay (stated **twice**).
11. Cross-sell (Combo / related) with **paid-placement disclosure** if sponsored.
12. **Full filterable reviews block (LOW):** overall + sub-rating bars + optional **AI review summary**
    (labelled AI-assisted + citation trace, ADR-0010) + Sort + theme-chip Filter; every review
    "Verified Booking".
**States:** in-stock · region-closed (`--warning`) · sold-out slot · Combo with one constituent
unavailable (intersection state, explicit). **A11y:** one H1; labelled anchor-nav with `aria-current`;
keyboard gallery + alt text; AI summary explicitly labelled.

### B3. Booking funnel: slot → participants → price-breakdown → pay

**Use** for the PDP booking module + the ≤2-screen checkout. **Selection collapses into the PDP**;
the dedicated checkout page is **identity + payment only**. Funnel (each step gates the next):
1. **Availability slot** — `Select`/calendar of `(start_at, capacity − capacity_taken)`;
   region-closure-aware; sold-out disabled with `--warning`.
2. **Participants** — stepper; **the Group-size bracket (1-2 / 3-5 / 6+) fires from the count** and
   is shown explicitly (which bracket + per-person price applies).
3. **Price-breakdown** — live, `.tabular-nums`, **before pay**: per-participant × bracket · Required
   permit/fee · subtotal · **Advance due now (25%) vs balance at T-24h** under Partial pay. This is
   the money-moment (A7 deliberate reveal).
4. **Pay** — checkout ≤2 screens, **email-first, guest-allowed** (never gate Booking behind an
   account). Screen 1 = Customer info (+ Trusted contact if safety-stack Experience); Screen 2 =
   payment (Razorpay). **Persistent order-summary rail** (slot, participants, price split,
   cancellation terms) on every screen.
**Cross-cutting:** cancellation/refund clarity lives **inside checkout**; Partial-pay eligibility
shown up front (Booking ≥48h out and ≤Rs.25,000 per CONTEXT.md) with a graceful explained-ineligible
case; multi-item cart is an optional differentiator (TripGroups / Combo). **States:** slot-unselected
(downstream disabled) · participants-set · breakdown-loading/ready · partial-pay-ineligible
(explained) · holding (visible 30-min slot hold) · paying · payment-error (A6 money copy) · confirmed
→ **single unambiguous confirmation** (if balance pending: "Reserved — balance due <date>", restate
the Partial-pay schedule, deliver the voucher). **A11y:** stepwise disabled-until-ready announced;
price breakdown is `aria-live`; order-summary rail is a labelled complementary landmark.

### B4. Wallet two-bucket display

**Use** for the Customer `Wallet` surface and any refund-quote landing money in a bucket. Two Cards,
one per bucket (the distinction is load-bearing — CONTEXT.md / ADR-0004): **Outvers credit bucket**
(`--credit` + wallet icon; balance `.tabular-nums`; source tags; **expiry** as `--warning` chip when
near; copy: spendable only on Outvers Bookings, never cashable) and **Refund balance bucket**
(neutral/`--success` + check icon; **dual affordance** "use as Wallet credit (24–48h SLA)" vs "cash
out to original method (5–7 working-day Razorpay round-trip)"). **Combined header** shows the total
**always decomposed into the two buckets** (never one blended number). **Live refund quote** (from
B7) renders the **exact split** before confirm, in a Dialog (A4), tabular, deliberate reveal.
Transaction history Table (A3) tags each entry's bucket via the mapped Badge (`credit` vs `success`).
**States:** zero (A5) · credit-only · refund-only · both · credit-expiring-soon (`--warning`) ·
cash-out-pending (`--info`) · refund-blocked (honest constraint → support, A6).

### B5. Vendor onboarding wizard

**Use** for `vendor/onboarding` + the connected listing builder. **Stepper header** (`tabs`/`progress`
primitives) with numbered, labelled steps + completion ticks; persistent "X of N", revisitable.
**Onboarding steps:** (1) **branch on legal status early** — GST-registered vs unregistered (India
analog of GYG "company vs individual"; load-bearing, and unlike GYG made **correctable** with a clear
fix-path, not a 3-attempt dead-end) → (2) operating questions → (3) contact + **payout
currency/destination** → (4) create account → (5) **KYC** (PAN/Aadhaar → Identity verified Vendor;
+GSTIN-or-self-declaration + guide certs → Business verified Vendor, ADR-0007) → (6) verify.
**Commission shown BEFORE the final step** + **no upfront listing fee** — stated as trust lines.
**Listing builder** (GYG 13-step IA): category → title → description+highlights (**AI-assisted draft**,
labelled + audit row, ADR-0010) → locations → keywords → includes/excludes → guide/F&B/transport →
additional info → **photos (min 4)** → **product options** (duration, Group-size brackets +
per-bracket price, languages, meeting point) → **Required permit + safety-stack fields** (ADR-0015)
→ **itinerary builder** → review + compliance checkbox → publish. Each step is **Form pattern (A2)**;
sticky footer Back / Save-draft / Continue. **States:** step-locked · in-progress · step-valid ·
KYC-pending / auto-verified / manual-review ≤48h / **declined-with-fix-path** · draft-saved ·
submitted · published.

### B6. Admin / Vendor data-table + detail

**Use** for every admin queue and Vendor extranet list↔detail pair. **Master = Data table (A3)**
(filterable, sortable, status-mapped Badge, right-aligned tabular figures, toolbar, bulk actions,
numeric pagination; rows link to `…/[id]`). **Detail = the `[id]` route:** page header (title +
status Badge) → summary Card cluster (A1, money `.tabular-nums`) → action panel (Server-Action
buttons; destructive / money-moving actions confirm via **Dialog (A4)** with the exact figure shown
before commit — approve payout, resolve Dispute, process Refund) → related-records sub-tables /
audit trail. **Availability-calendar surface** (Vendor) offers a **calendar ⇄ manifest/roster toggle
(Tabs)** with booking cutoffs. **Vendor-dashboard** leads with a performance-snapshot metric Card row
+ actionable Insights, then the master table. **A11y:** descriptive row-link names; detail focus
lands on H1; destructive confirms default-focus cancel; status by icon+text; readable audit trail.

### B7. Cancel-with-live-refund-quote

**Use** for Customer-initiated cancellation from a Booking detail (the headline trust flow). Booking
detail → "Cancel Booking" → **Dialog (A4)** that computes and shows, **before confirm:** the active
Cancellation policy slab (Flexible/Moderate/Strict, locked at create), the **exact refund amount**
and **which Wallet bucket** it lands in (Outvers credit vs Refund balance, B4), and the
cancellation-fee portion. `.tabular-nums`, deliberate reveal. Confirm is non-default focus.
Inside-policy → auto-credit, no human review; outside-policy → explained as a Dispute route to
support (honest constraint). **The Outvers differentiator:** exact-refund-before-confirm + two-bucket
split.

### B8. Vendor-profile (differentiator surface)

**Use** for the public Vendor storefront (`/{lng?}/vendor/{slug}`). Header: Vendor name + **Identity/
Business verified Vendor badge** (`--success` + icon, ADR-0007) + aggregate **provider rating**
(distinct from per-Experience rating) + **response-time SLA** signal + cancellation track record →
all Experiences in a Card grid (A1) → reviews. A rich standalone storefront none of the competitors
expose.

### Pattern → primitive → token → benchmark matrix

| Pattern | Primitives | Key tokens | Benchmark |
|---|---|---|---|
| A1 Card | card, badge, avatar | `--radius-card`, `--surface-1`, `--shadow-sm/md`, status colors | GYG/Klook decision-complete cards |
| A2 Form | input, textarea, label, select, radio-group, button | `--space-field`, `--text-xs`, `--destructive(-subtle)`, focus ring | GYG lean 2-step checkout |
| A3 Table | table, card, badge, input | status family, `.tabular-nums`, `--shadow-sm` | GYG/Viator manifest |
| A4 Dialog/Sheet | dialog, sheet, button | `--surface-2/3`, `--shadow-lg/popout`, `--duration-slow` | Refund-before-confirm |
| A5 Empty | card, table, button | `--text-lg/xs`, `bg-muted` | Klook dead-ends to avoid |
| A6 Error | alert (CVA), button | `--destructive-subtle`, `--text-display/h1` | Indiahikes honest constraint |
| A7 Skeleton | skeleton | `animate-pulse`, `--duration-deliberate` | Headout <2s TTI |
| B1 Search/Filter/Results | select, tabs, sheet, card, badge | facet tokens, `--info`, `--space-grid-gap` | Klook facets / GYG ranking |
| B2 Experience-detail | tabs (anchor), accordion, badge, avatar | `--space-section`, status colors, `--text-h1/h2` | GYG order + Viator anchor |
| B3 Booking funnel | select, radio-group, button, sheet, card | `.tabular-nums`, `--info`/`--success`, `--duration-deliberate` | GYG 2-screen email-first |
| B4 Wallet two-bucket | card, badge, table, dialog | `--credit`, `--success`, `--warning`, `.tabular-nums` | Indiahikes voucher-vs-cash |
| B5 Onboarding wizard | tabs, progress, input, select, button | status family, `--space-section`, `--text-h3` | GYG 6+13-step IA |
| B6 Admin table+detail | table, card, dialog, badge, button, tabs | status family, `.tabular-nums`, `--shadow-lg` | GYG/Viator extranet |
| B7 Cancel+refund-quote | dialog, badge, button | `--credit`/`--success`, `.tabular-nums`, deliberate reveal | Indiahikes live preview |
| B8 Vendor-profile | card, avatar, badge, tabs | `--success` (verified), provider-rating | GYG provider rating |

---

## 5. Accessibility baseline (the AA+ contract, codified)

- **Body & all text < 18px: ≥ 4.5:1** against its surface (WCAG AA). Target **≥ 7:1** for primary
  body copy where achievable (AAA) — cheap given the near-black `--foreground`.
- **Large text (≥ 18px / 24px bold) and non-text UI** (input borders, focus ring, status icons, the
  verified-Vendor dot): **≥ 3:1** (AA non-text).
- **Coral as foreground always uses `--primary-strong`** (the as-is `--primary` coral-on-white text
  was ≈3.5:1, below the 4.5:1 floor). `--primary` is for fills (white-on-coral) only.
- **Status colors never carry meaning by color alone** — every status token ships with a paired
  lucide icon (check / clock / info / wallet / alert). WCAG 1.4.1; redundancy cue for low-end displays.
- **Focus visibility is foundational:** the `focus-visible:ring-3 ring-ring/50` pattern is global,
  with `--ring` bound to `--primary-strong` so the ring clears 3:1 on light surfaces.
- **Reduced motion is foundational** (global `prefers-reduced-motion` block, §2.6) — movement
  collapses to fade/no-op; opacity/color transitions may remain.
- **Forms:** programmatic `Label` for every control; errors `role="alert"` + `aria-describedby`;
  required marked in **text**, not color; focus management on failed submit; **44px min touch
  targets** (India mobile-first).
- **Overlays:** focus trap + restore; destructive confirms default-focus the cancel/non-destructive
  option; `aria-labelledby`/`aria-describedby` from Title/Description.
- **Async:** `aria-busy` + visually-hidden "Loading…" on skeletons; `aria-live="polite"` on regions
  that receive a resolved money figure (refund split, price breakdown) so SR users hear it.
- **Multi-script:** the warm-hue contrast headroom and generous body line-height (1.6) protect
  Devanagari/Tamil/Bengali legibility without per-page re-tuning (ADR-0012).
- **Errors leak no sensitive detail** to the UI; server logs hold the detail.

---

## 6. Redesign archetypes → routes

The variant phase targets these **24 archetypes**. Each is a distinct page/surface template; routes
are the real `app/` paths they govern. Archetypes reuse the §4 patterns (referenced in brackets).

| # | Archetype | Pattern(s) | Route(s) |
|---|---|---|---|
| 1 | Marketing landing / home | B1 hero, A1 | `app/[locale]/(marketing)` (home) |
| 2 | Search results | B1, A1, A7 | `app/[locale]/(marketing)/search` |
| 3 | Activity-city collection | B1, A1 | `app/[locale]/(marketing)/adventure`, `…/adventure/[slug]` |
| 4 | Experience detail (PDP) | B2, B3, A1 | `app/[locale]/(marketing)/experience/[slug]` |
| 5 | Vendor public profile / storefront | B8, A1 | `app/[locale]/(marketing)/vendor/[slug]` |
| 6 | Content / policy page (Cancellation & Refund) | type+measure (§2.2), anchor-nav | `app/[locale]/(marketing)/cancellation-policy` |
| 7 | Auth / sign-in | A2 | `app/[locale]/(marketing)/sign-in` |
| 8 | Checkout (identity + payment, ≤2 screens) | B3, A2 | `app/(app)/checkout` |
| 9 | Booking confirmation | B3 confirmed-state, A1 | `app/(app)/bookings/[id]/confirmation` |
| 10 | Customer Booking detail | A1, B7 entry | `app/(app)/bookings/[id]` |
| 11 | Cancel-with-live-refund-quote | B7, A4 | `app/(app)/bookings/[id]/cancel` |
| 12 | Customer dashboard / Wallet (two-bucket) | B4, A1, A3 | `app/(app)/dashboard` |
| 13 | Vendor dashboard (metrics hub) | B6 dashboard, A1, A3 | `app/vendor/dashboard` |
| 14 | Vendor onboarding wizard | B5, A2 | `app/vendor/onboarding` |
| 15 | Vendor listing builder + edit | B5 builder, A2 | `app/vendor/listings`, `…/new`, `…/[id]`, `…/[id]/edit` |
| 16 | Vendor availability calendar ⇄ manifest | B6 toggle, A3 | `app/vendor/listings/[id]/availability` |
| 17 | Vendor master table + detail (bookings, payouts, reviews) | B6, A3 | `app/vendor/bookings`, `…/[id]`, `app/vendor/payouts`, `app/vendor/reviews` |
| 18 | Vendor messaging (list + thread) | A3 list, A2 reply | `app/vendor/messages`, `…/[id]` |
| 19 | Vendor settings | A2 | `app/vendor/settings` |
| 20 | Admin dashboard / analytics / reports | B6 dashboard, A1, A3 | `app/admin/dashboard`, `app/admin/analytics`, `app/admin/reports` |
| 21 | Admin master table + detail — money queues (bookings, refunds, payouts, commission) | B6, A3, A4 confirm | `app/admin/bookings`, `…/[id]`, `app/admin/refunds`, `app/admin/payouts`, `app/admin/commission` |
| 22 | Admin Vendor verification / KYC review | B6, A4, B5 KYC mirror | `app/admin/vendors`, `…/[id]` |
| 23 | Admin disputes & support queues | B6, A4, A2 | `app/admin/disputes`, `app/admin/support`, `…/[id]` |
| 24 | Admin operations config (region-closures, promo, loyalty, experiences, blog, site-builder, sub-admins) | A2, A3, B6 | `app/admin/region-closures`, `app/admin/promo`, `app/admin/loyalty`, `app/admin/experiences`, `app/admin/blog`, `app/admin/site-builder`, `app/admin/sub-admins` |

**System-level archetypes (apply across all 24, governed by the A-patterns):** empty state (A5),
error / 404 (A6, `app/error.tsx` + `app/not-found.tsx`), and loading skeleton (A7, route
`loading.tsx`) are *states* every archetype must render, not separate pages.

---

## 7. What changed from as-is, and why (delta)

| # | Change | Why (best-practice + research) |
|---|---|---|
| 1 | **Added a semantic-status color family** (`--success/-warning/-info/-credit` + subtle tints), keeping `--destructive` | The as-is had only coral + `destructive` — no token for free-cancellation, instant-confirm, verified-Vendor, urgency, or **Outvers credit**. Every competitor renders these on every card; they must be foundational. (Material 3 / Radix functional-status convention.) |
| 2 | **Unified neutrals on the warm hue (≈30) + added a 4-step surface ramp** (`--surface-0..3`); re-hued `--border`/`--input`/`--muted-foreground` | The as-is mixed warm surface (hue 30/60) with cool-slate text/borders (hue 250) — a subtle clash that muddied elevation. Single-hue ramps are a Radix/Material best practice and give the sticky booking module a defined elevation. |
| 3 | **Added `--primary-strong` for coral-as-foreground**; `--primary` is fills only | As-is coral-on-white text ≈ 3.5:1 fails AA (4.5:1 floor). Fix is a darkened action ink for links/labels/icons; `--ring` rebinds to it. |
| 4 | **Darkened `--muted-foreground`** (≈4.6:1 → ≈5.6:1) | It was borderline AA yet used for *all* secondary copy/captions/table sub-labels — exactly where headroom matters, and where multi-script counters need it. |
| 5 | **Promoted a distinct display heading face** (Bricolage Grotesque) bound to `--font-heading` | As-is `--font-heading = var(--font-sans)` produced **no hierarchy**; long PDPs and the 12-section policy page need a display tier. Indic locales fall back to Noto (display = Latin enhancement only). |
| 6 | **Added a tokenized 9-step type scale** (`--text-display..-2xs` with LH/tracking) + `--measure: 68ch` | As-is had **no `--text-*` tokens** — sizing was ad-hoc raw Tailwind. A modular scale + measure cap is required for dense cards and long-form legibility. |
| 7 | **Added `.tabular-nums` convention** for prices, refund slabs, Group-size counts, Wallet balances | Misaligned proportional figures undermine the money-correctness trust this redesign wins on (Indiahikes exact-refund, Thrillophilia slabs). |
| 8 | **Added 6 semantic spacing aliases** over the kept 4px scale | As-is had **zero spacing tokens**, causing density drift between the two card idioms. Aliases give one named source of truth without re-flowing layout. |
| 9 | **Added 3 radius semantic aliases** (`-card/-control/-pill`); kept the `calc()` ladder | The radius mechanism was the strongest part of the as-is — kept verbatim; aliases make the implicit contracts explicit (the two card idioms shared `rounded-xl` by coincidence). |
| 10 | **Added a 5-tier shadow system** (`--shadow-xs..popout`); surface-led in dark | As-is had **no shadow tokens** and the two card idioms disagreed (ring vs `shadow-sm`). The sticky booking module needs a defined raised-vs-overlay distinction. |
| 11 | **Added 4 duration + 4 easing motion tokens + a global reduced-motion contract** | As-is had **no motion tokens** and only the card hover-lift had a `motion-reduce` guard. One motion personality + a system-wide WCAG 2.3.3 contract. |
| 12 | **Unified the two card idioms** (`ui/card` ring-edge vs bespoke `experience-card` border+shadow) into one Card contract (A1) | The as-is split was flagged as a consistency defect; one rounding + elevation contract removes it. |
| 13 | **Added an Alert/Banner component** (CVA + status tokens) | The as-is had **no alert primitive**; needed for form-error summary, ranking disclosure, money-path errors, honest-constraint notices. |
| 14 | **Upgraded forms:** inline blur+submit validation, focusable error summary, real submit spinner | As-is forms validated on submit only and signaled loading by swapping label text — the spinner + inline validation cut the submit-fail-rescroll loop. |
| 15 | **Upgraded empty/error states:** icon/illustration, primary CTA, filtered-empty variant, honest money-path error copy | As-is empties had no icon and dead-ended; errors were generic. Empties become launchpads; money errors get explicit recovery copy. |
| 16 | **`next-intl` on all empty/error copy** | As-is `app/error.tsx` and several vendor/admin empties hardcoded English — a localization defect under ADR-0012. |
| 17 | **Made mandatory pattern rules:** decision-complete surfaces, status-with-icon, money-tabular-before-commit, skeleton-mirrors-layout, ranking-transparency disclosure, two-bucket Wallet decomposition, refund-before-confirm | These encode the trust/money-correctness differentiators (GYG/Klook/Viator/Indiahikes benchmarks) the redesign is built to win. |

**Net:** the three biggest functional gaps — a **status-color vocabulary**, a **tokenized type scale
with tabular numerics**, and **named elevation + motion** — are now foundations, each traceable to a
best-practice principle and a cited competitor/domain finding, all implementable as additive tokens
and CVA variants on the existing Tailwind v4 + Base UI/shadcn stack. No framework, font-loader,
OKLCH, or primitive-API change.
