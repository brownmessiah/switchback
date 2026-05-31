'use client'

import { CheckCircle2, Clock, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

import { updatePayoutMethodAction } from './actions'

interface PayoutMethodFormProps {
  initialPayoutMethod: 'upi' | 'bank_account' | null
  initialPayoutDestination: Record<string, string> | null
  payoutDestinationChangedAt: Date | null
}

const COOLING_OFF_MS = 7 * 24 * 60 * 60 * 1000

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Render the live remaining duration as a human "Xd Yh Zm" string from a
 * millisecond delta. Returns null once the window has elapsed.
 */
function formatRemaining(ms: number): string | null {
  if (ms <= 0) return null
  const totalMinutes = Math.ceil(ms / (60 * 1000))
  const days = Math.floor(totalMinutes / (60 * 24))
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60)
  const minutes = totalMinutes % 60

  const parts: string[] = []
  if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'}`)
  if (hours > 0) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`)
  // Only surface minutes when there is less than a day left, to keep it tidy.
  if (days === 0 && minutes > 0)
    parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`)
  return parts.length > 0 ? parts.join(' ') : 'less than a minute'
}

export function PayoutMethodForm({
  initialPayoutMethod,
  initialPayoutDestination,
  payoutDestinationChangedAt,
}: PayoutMethodFormProps) {
  const [method, setMethod] = useState<'upi' | 'bank_account'>(
    initialPayoutMethod ?? 'upi',
  )
  const [vpa, setVpa] = useState(initialPayoutDestination?.vpa ?? '')
  const [accountNumber, setAccountNumber] = useState(
    initialPayoutDestination?.accountNumber ?? '',
  )
  const [ifsc, setIfsc] = useState(initialPayoutDestination?.ifsc ?? '')
  const [accountHolderName, setAccountHolderName] = useState(
    initialPayoutDestination?.accountHolderName ?? '',
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  // ── Live 7-day cooling-off countdown (ADR-0016) ───────────────────────────
  // Hydration-safe: "now" is NEVER read at SSR render (that would mismatch the
  // client clock). We seed `now` to null and fill it on mount in useEffect,
  // then tick once a minute. Until the effect runs, no live figure renders —
  // so server and first client paint are identical.
  const changedAtMs = payoutDestinationChangedAt
    ? new Date(payoutDestinationChangedAt).getTime()
    : null
  const coolingOffEndsAt =
    changedAtMs !== null ? new Date(changedAtMs + COOLING_OFF_MS) : null

  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    if (changedAtMs === null) return
    setNow(Date.now())
    const interval = setInterval(() => setNow(Date.now()), 60 * 1000)
    return () => clearInterval(interval)
  }, [changedAtMs])

  const remainingMs =
    changedAtMs !== null && now !== null
      ? changedAtMs + COOLING_OFF_MS - now
      : null
  const remainingLabel =
    remainingMs !== null ? formatRemaining(remainingMs) : null
  const coolingOffActive = remainingMs !== null && remainingMs > 0

  // Show the WARNING cooling-off Alert whenever a destination change exists AND
  // we haven't CONFIRMED elapse against a real client clock — i.e. either the
  // window is still active, OR we're pre-mount (`now === null`). Only flip to
  // the SUCCESS "ended / receiving funds" Alert once a real clock confirms the
  // window has elapsed. This prevents a freshly-changed (genuinely-active)
  // destination from flashing the FALSE green "receiving funds" state at SSR /
  // first paint (the inverse money-state, ADR-0016).
  const showCoolingOffWarning =
    changedAtMs !== null && (coolingOffActive || now === null)
  const showCoolingOffEnded =
    changedAtMs !== null && now !== null && !coolingOffActive

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess(false)
    setLoading(true)

    try {
      const result =
        method === 'upi'
          ? await updatePayoutMethodAction({
              payoutMethod: 'upi',
              payoutDestination: { vpa },
            })
          : await updatePayoutMethodAction({
              payoutMethod: 'bank_account',
              payoutDestination: { accountNumber, ifsc, accountHolderName },
            })

      if (!result.ok) {
        setError(result.error)
        return
      }

      setSuccess(true)
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-heading">Payout method</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Live cooling-off status object (ADR-0016). Renders whenever a
              destination change exists. PRE-MOUNT (`now === null`) we render the
              WARNING "cooling-off in effect" branch with neutral copy (NOT the
              success branch) — so a genuinely-active window never flashes the
              false green "receiving funds" state at SSR / first paint. Once the
              mount effect fills `now`, the live remaining countdown appears, and
              only a real-clock-confirmed elapse flips to the SUCCESS Alert. */}
          {showCoolingOffWarning && coolingOffEndsAt && (
            <Alert variant="warning" data-testid="payout-cooling-off">
              <Clock aria-hidden="true" />
              <AlertTitle>Bank-change cooling-off period active</AlertTitle>
              <AlertDescription>
                <p>
                  {remainingLabel ? (
                    <>
                      <span className="font-medium tabular-nums">
                        {remainingLabel}
                      </span>{' '}
                      remaining in the 7-day cooling-off period. Your new
                      destination starts receiving funds on{' '}
                      <span className="font-medium tabular-nums">
                        {formatDate(coolingOffEndsAt)}
                      </span>
                      .
                    </>
                  ) : (
                    <>
                      Your payout destination was recently changed. The new
                      destination starts receiving funds on{' '}
                      <span className="font-medium tabular-nums">
                        {formatDate(coolingOffEndsAt)}
                      </span>{' '}
                      (7-day cooling-off period).
                    </>
                  )}
                </p>
              </AlertDescription>
            </Alert>
          )}

          {showCoolingOffEnded && coolingOffEndsAt && (
            <Alert variant="success" data-testid="payout-cooling-off">
              <CheckCircle2 aria-hidden="true" />
              <AlertTitle>Payout destination active</AlertTitle>
              <AlertDescription>
                <p>
                  Your payout destination is active and receiving funds. The
                  7-day cooling-off period ended on{' '}
                  <span className="font-medium tabular-nums">
                    {formatDate(coolingOffEndsAt)}
                  </span>
                  .
                </p>
              </AlertDescription>
            </Alert>
          )}

          <RadioGroup
            value={method}
            onValueChange={(val) => setMethod(val as 'upi' | 'bank_account')}
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="upi" id="payout-upi" />
              <Label htmlFor="payout-upi">UPI VPA</Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="bank_account" id="payout-bank" />
              <Label htmlFor="payout-bank">Bank account (IMPS/NEFT)</Label>
            </div>
          </RadioGroup>

          {method === 'upi' && (
            <div className="space-y-2">
              <Label htmlFor="vpa">UPI VPA</Label>
              <Input
                id="vpa"
                value={vpa}
                onChange={(e) => setVpa(e.target.value)}
                placeholder="yourname@upi"
                required
              />
              <p className="text-xs text-muted-foreground">
                e.g. vendorbusiness@paytm, name@okicici
              </p>
            </div>
          )}

          {method === 'bank_account' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="accountHolderName">Account holder name</Label>
                <Input
                  id="accountHolderName"
                  value={accountHolderName}
                  onChange={(e) => setAccountHolderName(e.target.value)}
                  placeholder="Account holder's full name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="accountNumber">Account number</Label>
                <Input
                  id="accountNumber"
                  className="tabular-nums"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="Bank account number"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ifsc">IFSC code</Label>
                <Input
                  id="ifsc"
                  className="tabular-nums uppercase"
                  value={ifsc}
                  onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                  placeholder="e.g. HDFC0001234"
                  required
                />
              </div>
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                <p>{error}</p>
              </AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert variant="success">
              <CheckCircle2 aria-hidden="true" />
              <AlertDescription>
                <p>
                  Payout method updated. A 7-day cooling-off period applies
                  before the new destination receives funds.
                </p>
              </AlertDescription>
            </Alert>
          )}

          <Button type="submit" disabled={loading}>
            {loading && (
              <Loader2 aria-hidden="true" className="animate-spin" />
            )}
            {loading ? 'Saving...' : 'Update payout method'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
