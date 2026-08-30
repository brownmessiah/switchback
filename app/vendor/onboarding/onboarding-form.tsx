'use client'

import { Check, IdCard, ShieldCheck, Store } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/lib/toast'

import { createVendorProfileAction } from './actions'

type Step = 1 | 2 | 3

interface OnboardingFormProps {
  userId: string
}

// The platform's single default commission rate (ADR-0008 /
// PLATFORM_DEFAULT_COMMISSION_RATE = '20.00'; per-Vendor base rate also
// defaults to 20%). Shown transparently as a trust line BEFORE the final
// step (DESIGN.md B5). Not a money-path computation — a static disclosure.
const PLATFORM_COMMISSION_PERCENT = '20%'

// Calm trust-ladder: one decision per screen, labelled + revisitable.
const STEPS: { id: Step; label: string }[] = [
  { id: 1, label: 'Business' },
  { id: 2, label: 'Verification' },
  { id: 3, label: 'Review' },
]

// Client-side draft persistence (variant C's Save-draft, fold-in). Restored
// in useEffect (never at render) to avoid a hydration mismatch. No backend
// draft storage exists — this is purely localStorage convenience.
const DRAFT_KEY = 'outvers:vendor-onboarding-draft'

interface DraftState {
  businessName: string
  slug: string
  pan: string
  about: string
}

function deriveSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50)
}

export function OnboardingForm({ userId: _userId }: OnboardingFormProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [businessName, setBusinessName] = useState('')
  const [slug, setSlug] = useState('')
  const [pan, setPan] = useState('')
  const [about, setAbout] = useState('')

  // Restore any locally-saved draft on mount (client-only, post-hydration).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY)
      if (!raw) return
      const draft = JSON.parse(raw) as Partial<DraftState>
      if (typeof draft.businessName === 'string') setBusinessName(draft.businessName)
      if (typeof draft.slug === 'string') setSlug(draft.slug)
      if (typeof draft.pan === 'string') setPan(draft.pan)
      if (typeof draft.about === 'string') setAbout(draft.about)
    } catch {
      // Corrupt/blocked storage is non-fatal — just start with an empty form.
    }
  }, [])

  // Persist the draft as the Vendor types (debounce-free; the payload is tiny).
  useEffect(() => {
    try {
      window.localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ businessName, slug, pan, about } satisfies DraftState),
      )
    } catch {
      // Storage unavailable (private mode / quota) — degrade silently.
    }
  }, [businessName, slug, pan, about])

  function handleBusinessNameChange(value: string) {
    setBusinessName(value)
    setSlug(deriveSlug(value))
  }

  async function handleSubmit() {
    setError('')
    setLoading(true)
    try {
      const result = await createVendorProfileAction({
        businessName,
        slug,
        pan: pan || undefined,
        about: about || undefined,
      })
      if (!result.ok) {
        setError(result.error)
        toast.error(result.error)
        return
      }
      // Clear the local draft on a successful create — it's now persisted
      // server-side as a real Vendor profile.
      try {
        window.localStorage.removeItem(DRAFT_KEY)
      } catch {
        // Non-fatal.
      }
      // Vendor application saved (issue 24).
      toast.success('Vendor profile created. Welcome to Switchback.')
      router.push('/vendor/dashboard')
    } catch {
      setError('Something went wrong. Please try again.')
      toast.error('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Persistent trust banner (DESIGN.md B5 + commission transparency) ──
          Rides every step: "0% upfront fee" + commission-before-you-finish.
          success-subtle tint + paired lucide icon so the signal is never
          carried by color alone (DESIGN.md §1.3 / §5). */}
      <div
        data-testid="onboarding-trust-banner"
        className="flex items-start gap-3 rounded-lg bg-success-subtle p-4"
      >
        <ShieldCheck
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-success"
        />
        <div className="space-y-0.5 text-sm">
          <p className="font-medium text-success">
            0% upfront fee — listing on Switchback is free.
          </p>
          <p className="text-foreground/80">
            Commission is shown before you finish — you only pay when you earn.
            The platform rate is{' '}
            <span className="font-medium tabular-nums">
              {PLATFORM_COMMISSION_PERCENT}
            </span>{' '}
            on confirmed bookings, nothing else.
          </p>
        </div>
      </div>

      {/* ── Calm B5 trust-ladder: numbered, labelled, revisitable steps ────
          The ladder wraps on narrow screens (flex-wrap) so three labelled
          steps + connectors never force a horizontal scroll at 360px; each
          step keeps min-w-0 so its label can ellipsis rather than overflow. */}
      <nav aria-label="Onboarding progress">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-3">
          {STEPS.map((s, i) => {
            const isDone = step > s.id
            const isCurrent = step === s.id
            return (
              <li key={s.id} className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  aria-current={isCurrent ? 'step' : undefined}
                  className={[
                    'flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums transition-colors',
                    isDone
                      ? 'bg-success text-success-foreground'
                      : isCurrent
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground',
                  ].join(' ')}
                >
                  {isDone ? (
                    <Check aria-hidden="true" className="size-4" />
                  ) : (
                    s.id
                  )}
                </span>
                <span
                  className={[
                    'min-w-0 truncate text-sm font-medium',
                    isCurrent
                      ? 'text-foreground'
                      : isDone
                        ? 'text-success'
                        : 'text-muted-foreground',
                  ].join(' ')}
                >
                  {s.label}
                </span>
                {i < STEPS.length - 1 && (
                  <span
                    aria-hidden="true"
                    className={[
                      'ml-1 h-px flex-1',
                      step > s.id ? 'bg-success' : 'bg-border',
                    ].join(' ')}
                  />
                )}
              </li>
            )
          })}
        </ol>
        <p className="mt-3 text-xs text-muted-foreground tabular-nums">
          Step {step} of {STEPS.length}
        </p>
      </nav>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Store aria-hidden="true" className="size-5 text-primary-strong" />
              Business details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Paired fields collapse to one column on mobile and split into a
                2-col field group at md (DESIGN.md §8 forms rule). */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="businessName">Business name</Label>
                <Input
                  id="businessName"
                  value={businessName}
                  onChange={(e) => handleBusinessNameChange(e.target.value)}
                  placeholder="e.g. Himalayan Adventures"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="slug">Profile URL</Label>
                {/* min-w-0 lets the input shrink inside its grid cell so the
                    "outvers.in/vendor/" prefix never pushes past 360px. */}
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-sm text-muted-foreground">
                    outvers.in/vendor/
                  </span>
                  <Input
                    id="slug"
                    className="min-w-0"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="himalayan-adventures"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="about">About your business (optional)</Label>
              <Textarea
                id="about"
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                placeholder="Tell potential customers about your experience running adventures..."
                rows={3}
              />
            </div>

            <Button
              className="w-full"
              onClick={() => setStep(2)}
              disabled={!businessName || !slug}
            >
              Continue
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <IdCard aria-hidden="true" className="size-5 text-primary-strong" />
              Verification — you can finish this later
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Forgiving KYC framing (DESIGN.md B5 / ADR-0007 fix-path): no
                dead-end. PAN is optional now; identity verification happens
                later via the admin manual-approve path, and the Vendor can
                proceed and verify after onboarding. */}
            <div className="flex items-start gap-3 rounded-lg bg-info-subtle p-3">
              <ShieldCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-info"
              />
              <p className="text-xs text-info">
                Nothing here blocks you. You can create your profile now and
                verify whenever you&apos;re ready — our team reviews and approves
                identity documents manually, so there&apos;s no dead-end and no
                rush.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="pan">PAN number (optional)</Label>
              <Input
                id="pan"
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase().slice(0, 10))}
                placeholder="ABCDE1234F"
                maxLength={10}
              />
              <p className="text-xs text-muted-foreground">
                Adding your PAN now speeds up Identity verification (Tier 2)
                later. Leave it blank to continue and add it any time.
              </p>
            </div>

            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm text-muted-foreground">
                Aadhaar verification and document upload will be available when
                external services are connected. Until then, our team verifies
                you manually after you create your profile — you keep full access
                to draft listings in the meantime.
              </p>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button className="flex-1" onClick={() => setStep(3)}>
                Continue
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Check aria-hidden="true" className="size-5 text-primary-strong" />
              Confirm &amp; create profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg bg-muted/50 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Business name</span>
                <span className="font-medium">{businessName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Profile URL</span>
                <span className="font-mono text-xs">/vendor/{slug}</span>
              </div>
              {pan && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">PAN</span>
                  <span className="font-mono text-xs">{pan}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Commission</span>
                <span className="font-medium tabular-nums">
                  {PLATFORM_COMMISSION_PERCENT} on confirmed bookings
                </span>
              </div>
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/5 p-3"
              >
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setStep(2)}>
                Back
              </Button>
              <Button className="flex-1" onClick={handleSubmit} disabled={loading}>
                {loading ? 'Creating...' : 'Create vendor profile'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
