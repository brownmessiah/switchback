'use client'

import { useState } from 'react'

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

  // 7-day cooling-off per ADR-0016
  const coolingOffActive =
    payoutDestinationChangedAt !== null &&
    Date.now() - new Date(payoutDestinationChangedAt).getTime() <
      7 * 24 * 60 * 60 * 1000

  const coolingOffEndsAt = payoutDestinationChangedAt
    ? new Date(
        new Date(payoutDestinationChangedAt).getTime() +
          7 * 24 * 60 * 60 * 1000,
      )
    : null

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
        <CardTitle>Payout method</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {coolingOffActive && coolingOffEndsAt && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-50 p-3 dark:bg-amber-950/20">
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Payout destination was recently changed. New destination will
                receive funds after{' '}
                {coolingOffEndsAt.toLocaleDateString('en-IN', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
                {' '}(7-day cooling-off period).
              </p>
            </div>
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
                  value={ifsc}
                  onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                  placeholder="e.g. HDFC0001234"
                  required
                />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {success && (
            <div className="rounded-lg border border-green-500/30 bg-green-50 p-3 dark:bg-green-950/20">
              <p className="text-sm text-green-700 dark:text-green-400">
                Payout method updated. A 7-day cooling-off period applies before
                the new destination receives funds.
              </p>
            </div>
          )}

          <Button type="submit" disabled={loading}>
            {loading ? 'Saving...' : 'Update payout method'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
