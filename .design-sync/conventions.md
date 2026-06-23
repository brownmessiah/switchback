# Outvers UI — building with this design system

Outvers is an adventure-activity marketplace in India (treks, rafting, scuba,
paragliding). These are the **real, shipped** React components from the product,
compiled with their Tailwind v4 styling. Build screens by composing them — every
component is fully styled out of the box.

## Setup & theme — no provider needed

Components are self-contained: import and render them directly, no context
provider required (the one exception is `Tooltip`, which must be wrapped in
`<TooltipProvider>`). Tokens, fonts, and component styles all arrive through the
bound stylesheet — nothing to configure.

- **Light is the default.** Dark mode is opt-in: add `class="dark"` to a root
  ancestor (e.g. `<html>` or a wrapper `<div>`) and every token flips to the
  dark palette automatically.
- **Fonts** are bound for you: body text is **DM Sans** (`var(--font-sans)`),
  headings are **Bricolage Grotesque** (`var(--font-heading)`).

## Styling idiom — Tailwind v4 utilities + design tokens

This is a Tailwind v4 system. Style your own layout with utility classes; for any
brand value, the safest surface is the **design token CSS variable** (always
present in the stylesheet). Use the semantic token, never a raw hex.

**Brand color tokens** (as `bg-*` / `text-*` / `border-*` utilities, or
`var(--*)`):
- `primary` — Outvers coral, the brand action color (`bg-primary` +
  `text-primary-foreground`). `primary-strong` for coral text/icons that must
  clear contrast.
- `foreground` / `background`, `card`, `muted` + `muted-foreground` (secondary
  text), `border`, `secondary`, `accent`.
- Neutral surface ramp: `surface-0` → `surface-3` (rising elevation).
- Status families, each with a `-foreground` and a `-subtle` background:
  `success`, `warning`, `info`, `credit` (wallet), `destructive`.

**Radius**: `rounded-lg` for controls; card and pill radii via the tokens
`var(--radius-card)` and `var(--radius-pill)`.
**Type scale** (utilities): `text-h1`–`text-h3`, `text-base`, `text-sm`,
`text-xs`; headings pair with `font-heading`. (The `--text-display` token is
also available as a CSS variable.)

## Where the real definitions live

- The bound stylesheet (`styles.css` and its `@import` of `_ds_bundle.css`)
  defines every token and the compiled utilities — read it before inventing
  styles.
- Each component ships a `<Name>.prompt.md` with its props and a worked usage
  example. Read it before composing that component.

## Key components

Actions & inputs: `Button` (variants: default, secondary, outline, ghost,
destructive, link), `Input`, `Textarea`, `Label`, `RadioGroup`, `Select`.
Containers & feedback: `Card` (+ `CardHeader/Title/Description/Content/Footer`),
`Alert`, `Badge`, `Skeleton`, `Progress`, `Tooltip`, `Dialog`, `Sheet`.
Navigation & data: `Tabs`, `Accordion`, `Breadcrumb`, `Separator`, `Avatar`,
`Table`, `ResponsiveTable`, `DropdownMenu`.
Domain: `ExperienceCard` (the signature listing card — cover image, rating,
trust badges, price), `ReviewStars`, `TrustBadge`, `BookingStatusBadge`,
`EmptyState`.

## Idiomatic example

```tsx
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, Button, Badge } from "outvers-next";

export function TripSummary() {
  return (
    <Card style={{ maxWidth: 380 }}>
      <CardHeader>
        <CardTitle>Sunrise Trek to Triund</CardTitle>
        <CardDescription>Dharamshala · 2 days</CardDescription>
      </CardHeader>
      <CardContent className="text-muted-foreground">
        Overnight trek to the Triund ridge with camping and Dhauladhar views.
      </CardContent>
      <CardFooter style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 600 }}>₹2,499 <span className="text-muted-foreground">/ person</span></span>
        <Button>Book now</Button>
      </CardFooter>
    </Card>
  );
}
```
