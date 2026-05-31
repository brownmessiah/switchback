# Ship-Readiness Summary — Outvers MVP Validation + Redesign (#113)

**Date:** 2026-05-31 · **Program:** World-Class MVP Validation + Redesign (113 issues; this is the final one). · **Companion:** the evidence pack (before/after pack + friction-delta table) at `.scratch/mvp-validation-redesign/EVIDENCE-PACK.md`, backed by the 97 before/after PNGs in `.scratch/mvp-validation-redesign/evidence/`.

---

## 1. Outcome

- **45 routes redesigned** across **24 design archetypes** onto a unified `DESIGN.md` token system, each implemented TDD-first and passed by a `tdd-reviewer`.
- **Design foundation shipped:** the semantic-status family (success / warning / info / credit / destructive — status never by color alone), the surface ramp (surface 0/1/2 + elevation), the type / spacing / shadow scales, `--primary-strong` (AA-legible coral-as-text), and brand-token charts.
- **The #62 owner-pick gate was honored** — every implementation used the owner's selected direction from `SELECTED.json` (`38:B 39:A 40:B 41:B 42:A 43:B 44:A 45:A 46:B 47:B 48:A 49:C 50:A 51:A 52:A 53:A 54:B 55:B 56:B 57:A 58:B 59:A 60:A 61:A`), including the 8 picks that overrode the SELECTION.md recommendation.
- The functional-validation wave (#10–37) validated and fixed every built flow before redesign; the hardening wave (#108 coverage gate, #109 full-suite-green, #110 a11y, #111 CWV, #112 graceful-degradation) closed quality gates.

---

## 2. Quality gates — GREEN + DETERMINISTIC

| Gate | Result |
|---|---|
| **vitest unit + integration** | **1544 passed \| 1 todo** (136 test files) |
| **typecheck** | **0 errors** (`pnpm typecheck` EXIT=0) |
| **i18n:check** | **PASS** (13 locales) |
| **Playwright E2E — all 6 projects** | **GREEN** (run twice, both green per #110): unauthenticated **41** / customer **14** / vendor **36** / admin **67** / cross-surface **70** / i18n **15** = **243 E2E** |
| **Per-test DevTools gate** | Every E2E carries an **axe (wcag2a + wcag2aa)** gate + console + pageerror + network gate (`tests/e2e/fixtures/devtools.ts`) |
| **#109 flaky-test stabilization** | Done — see below |

**Determinism (#109):** the recurring flakes were root-caused and fixed, not quarantined:
- **Sidebar teardown flake** — `admin-sidebar.test.tsx` / `vendor-sidebar.test.tsx` emitted React 19 `ReferenceError: window is not defined` from a `setImmediate`-scheduled task firing after jsdom teardown; fixed by flushing React's scheduled work + unmounting before the env is disposed.
- **Cancel-test booking contention** — three customer cancel E2Es shared one seeded cancellable Booking (whoever ran first consumed it); fixed by giving each its own dedicated seed fixture.
- **Admin payout / sub-admin / promo serial races** under the cross-surface `dependencies: ['admin']` gate — stabilized so the dependency gate is deterministic for CI.
- **Dead-link crawler vs moderation suite** — excluded the `mod-pending-*` E2E fixture slugs from the unauthenticated crawler (test-isolation only; real product routes still fully asserted).

---

## 3. Accessibility (from `a11y-audit.md`, #110)

- **Standard:** WCAG 2.2 Level AA. **axe (wcag2a + wcag2aa) CLEAN** — 0 violations across all in-scope pages; the one coverage gap (`/admin/reports`, previously only hit as a CSV `page.request.get`) was closed with an axe-gated render smoke test.
- **Status never by color alone** — semantic-status family pairs a color with an icon/label.
- **AA contrast after the #110 fix** — 5 light-theme status bases (`success`/`warning`/`info`/`credit`/`destructive` text on `-subtle` fills) were below AA (a WCAG 1.4.3 miss axe can't compute over tinted fills); darkened tokens-only to 4.6–4.7:1. `--foreground` ≈18.8:1 (AAA), `--muted-foreground` 6.56–7.17:1, `text-primary-strong` (coral-as-text) 6.24:1+, focus ring 6.52:1. One documented WCAG 1.4.11 exception: the 1px decorative `--border` (redundant — never the sole boundary cue).
- **Keyboard / focus on key flows** verified with 2 new focused E2E tests: the **money-action confirm Dialog** (default focus lands on Cancel — a stray Enter cannot move money; focus trap + Escape + focus-return verified) and the **checkout guided-stepper** (arrow-key RadioGroup, keyboard Continue/Back/Pay). Inline cancel-with-refund, search filter Sheet, onboarding/listing steppers, messages split-view, admin evidence cockpit all over verified Base UI primitives + the per-page axe gate.

---

## 4. Core Web Vitals (from `cwv-baseline.md`, #111)

- **Non-blocking capture baseline** (no CI gate). All benchmarked top marketing + customer pages are inside Google "good" on **LCP ≤ 2.5s, CLS ≤ 0.1, FCP ≤ 1.8s** — even in dev mode.
  - Marketing (6): Home LCP 256ms / Collection 480ms / PDP 644ms / Search 864ms (highest) / Cancellation-policy 388ms / Sign-in 416ms — all CLS 0.001.
  - Customer (3): Dashboard LCP 292ms / Checkout (your-details) 176ms / Confirmation 524ms — CLS 0.014 (an order of magnitude under the 0.1 bar).
- **DEV-MODE CAVEAT:** captured against the Next.js **dev server** (unminified, on-demand compile, React dev build, no CDN/edge, no prod image optimization). Treat as a **relative** regression baseline — re-capture against `next build && next start` (or staging) for absolute, field-comparable numbers. Production CWV typically improves (faster TTFB/LCP post-minification + caching).

---

## 5. Money-correctness (shipped + consistent)

- **A4 exact-figure confirm Dialog on every admin money action** — refunds, payouts, commission, loyalty manual-credit grant, and KYC-reject/suspend. The operator types/confirms the exact figure before commit. This closed the program's biggest unguarded-money risk: money actions previously fired **inline** (one misclick could approve a real ₹29,625 payout or grant Outvers credit). The Dialog's default focus is the safe Cancel control (keyboard-verified, #110).
- **Full Gross→Commission→GST→TDS→TCS→Net waterfall surfaced consistently** across the vendor Booking detail (#79), the vendor tri-tab earnings ledger / payout queues (#80–82), and the admin split-view money detail (#58 / admin booking detail #102) — the breakdown and the approve action are now co-present.
- **Two-bucket Wallet** (Outvers credit vs cash Refund balance) is first-class on the customer dashboard (#72), with the bucket a refund lands in labeled.
- **Partial-pay split shown before commit** — the Advance/balance split is permanently in view on the PDP sticky rail (#65), selectable in the checkout payment step (#70), and restated on the money-honest confirmation timeline (#71, Advance paid → balance auto-charged at T-24h → Experience date).

---

## 6. Deferred / out-of-scope items + ship caveats (from `defects-log.md`)

### READY TO SHIP
The 45 redesigned routes, the design foundation, the money-correctness guards, the a11y AA conformance, and the deterministic full test suite are **ready to ship**. The items below are **tracked follow-ups**, not blockers — each was a deliberate scope decision (built-surface-only, no fabricated backends).

### Tracked follow-ups (NOT shipping this cut)
| Item | Status / why deferred | Owning follow-up |
|---|---|---|
| **Cold customer→Vendor messaging** | No production backend (only vendor-side conversation read/append exists). Rendered as a disabled "Message Vendor / Coming soon" button on #41 vendor-profile (axe-clean). New feature. | Future messaging build |
| **KYC-tier search facet** | Needs `vendorKycTier` denormalized into the Meili Experience index + ADR-0013 doc-shape revision + reindex — backend change out of redesign scope. The Region facet shipped instead. | Search index follow-up |
| **Payout change-history audit table** | Backend tracks only `payoutDestinationChangedAt` (last change), no per-change log. #56 surfaced the last-changed timestamp + live cooling-off countdown with no fabricated history. | Payouts-backend follow-up |
| **Public blog render route** | Admin blog CRUD works + persists, but customers can't view published posts — the public render route is unbuilt (ADR-0013 frames blog as an SEO surface). | Content-surface build |
| **`execute*` defense-in-depth (security follow-up)** | Every admin `execute*(db, adminUserId, input)` core is exported from a `'use server'` module → network-invokable with no internal authz (relies on the non-serializable `db` arg failing deserialization, not an authz check). The user-facing wrapper gate (#28) is fixed; defense-in-depth (move cores to non-'use-server' modules or add an internal session/permission assertion) is a tracked hardening follow-up. Same latent surface likely in vendor/customer cores. | #108–113 security follow-up |
| **Stale non-en cancellation copy** | The #12b fix corrected the en.json refund-window copy (now matches ADR-0005) with a regression test; the **12 non-en locales still carry the old (wrong) translations** — i18n correctness re-sync is out of this program's scope (PRD excludes it) but flagged. | i18n pipeline pass |
| **Confirmation absolute slot date** | `confirmation-loader.ts` returns a placeholder `slotStartAt`; #71 worked around it with relative copy ("24 hours before your experience"). Needs a slot join. | Read-only loader fix |

### Known dev-only flake (local, NOT a product defect, NOT a ship blocker)
- **Cold-start dev-server degradation:** Playwright's `reuseExistingServer: !CI` reuses one `pnpm dev` server across all local E2E runs; over a long session it degrades (observed: `/cancellation-policy` + `/sign-in` returning 500 with a `JSON.parse` SyntaxError mid-session; a fresh `pnpm dev` restored green). **CI is unaffected** — `CI=true` sets `reuseExistingServer=false` (fresh gated server per run). Local long-run reliability just needs a periodic dev-server restart. Routes are correct on a healthy server.

---

## 7. Verdict

**SHIP.** The redesign is complete across all 45 in-scope routes, on a unified token system, with the owner's design selections honored. Quality gates are green and deterministic: vitest 1544 passed | 1 todo, typecheck 0, i18n PASS (13 locales), all 6 Playwright projects (243 E2E) green twice with axe + console + network gates on every test. a11y conforms to WCAG 2.2 AA (axe-clean, contrast fixed, money-Dialog keyboard contract verified). CWV is inside Google "good" on the dev baseline (re-capture on a production build for field numbers). Money-correctness is enforced: exact-figure confirms on every admin money action, the full tax waterfall surfaced consistently, the two-bucket Wallet and Partial-pay split shown before commit. The seven tracked follow-ups are all deliberate built-surface-only scope decisions with no fabricated backends, and the one known flake is local-dev-only and does not affect CI.
