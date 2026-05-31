'use client'

import { useRef, useState, useTransition } from 'react'

import { ConfirmMoneyDialog } from '@/app/admin/_components/confirm-money-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { adminGrantCredit, type GrantCreditResult } from './actions'

type BalanceType = 'outvers_credit' | 'refund_balance'

/**
 * #96 — manual loyalty credit grant. A grant CREDITS real money to a Customer's
 * Wallet, so the action is gated behind the shared A4 ConfirmMoneyDialog
 * (DESIGN.md §4 A4): clicking "Grant Credit" opens a confirm that RESTATES the
 * EXACT ₹ figure being granted AND which bucket it lands in — the Outvers
 * credit bucket (closed-loop, WITH expiry per ADR-0004), NOT the cashable Refund
 * balance — before the operator commits. A misclick must NOT grant money:
 * adminGrantCredit fires only from the explicit Confirm inside the dialog. The
 * action + grant-logic are called UNCHANGED, with the same FormData inputs.
 */
export function GrantCreditForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<GrantCreditResult | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // The exact figure + bucket restated in the A4 confirm.
  const [amountRupees, setAmountRupees] = useState(0)
  const [balanceType, setBalanceType] = useState<BalanceType>('outvers_credit')
  // The captured submission — the EXACT inputs the action will receive, frozen
  // at submit time so React 19's post-action form reset can't lose them before
  // the operator confirms in the dialog.
  const pendingGrant = useRef<FormData | null>(null)

  // Clicking the form's submit opens the A4 confirm; it does NOT grant inline.
  function handleOpenConfirm(formData: FormData) {
    const amount = Number(formData.get('amountRupees'))
    const bucket = (formData.get('balanceType') as BalanceType) ?? 'outvers_credit'
    setResult(null)
    setAmountRupees(Number.isFinite(amount) ? Math.floor(amount) : 0)
    setBalanceType(bucket)
    pendingGrant.current = formData
    setConfirmOpen(true)
  }

  // The real money write — fires ONLY from the dialog's explicit Confirm.
  function handleConfirmGrant() {
    const formData = pendingGrant.current
    if (!formData) return
    startTransition(async () => {
      const res = await adminGrantCredit(formData)
      setResult(res)
      if (res.ok) {
        setConfirmOpen(false)
        pendingGrant.current = null
        formRef.current?.reset()
      }
    })
  }

  const isOutversCredit = balanceType === 'outvers_credit'
  const bucketLabel = isOutversCredit ? 'Outvers credit' : 'Refund balance'

  return (
    <>
      <form ref={formRef} action={handleOpenConfirm} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="userId">User ID</Label>
            <Input id="userId" name="userId" placeholder="user_abc123" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="amountRupees">Amount (INR)</Label>
            <Input
              id="amountRupees"
              name="amountRupees"
              type="number"
              min={1}
              placeholder="500"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="balanceType">Balance Type</Label>
            <select
              id="balanceType"
              name="balanceType"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              defaultValue="outvers_credit"
              required
            >
              <option value="outvers_credit">Outvers Credit</option>
              <option value="refund_balance">Refund Balance</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reason">Reason</Label>
            <Input
              id="reason"
              name="reason"
              placeholder="Goodwill gesture for delay"
              required
            />
          </div>
        </div>

        {result && !result.ok && (
          <p className="text-sm text-destructive" role="alert">
            {result.error}
          </p>
        )}
        {result?.ok && (
          <p className="text-sm text-green-600" role="status">
            Credit granted. Transaction: {result.walletTransactionId}
          </p>
        )}

        <Button type="submit" disabled={isPending}>
          {isPending ? 'Granting...' : 'Grant Credit'}
        </Button>
      </form>

      {/* A4 exact-figure confirm: restates the ₹ + the bucket it lands in
          (Outvers credit, closed-loop WITH expiry per ADR-0004, vs the cashable
          Refund balance) before the money write. */}
      <ConfirmMoneyDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) setConfirmOpen(false)
        }}
        dialogTestId="grant-credit-confirm"
        title="Grant Credit"
        actionLabel="Grant Credit"
        amountRupees={amountRupees}
        amountCaption={
          isOutversCredit
            ? 'Credited to Outvers credit (closed-loop promotional balance — expires 12 months from issue, ADR-0004).'
            : 'Credited to the Refund balance (cashable to the original payment method — no expiry).'
        }
        onConfirm={handleConfirmGrant}
        confirmDisabled={isPending || amountRupees <= 0}
        error={result && !result.ok ? result.error : null}
        description={
          isOutversCredit ? (
            <>
              This grants real money to the Customer&apos;s <strong>Outvers credit</strong>{' '}
              bucket — closed-loop promotional balance that <strong>expires</strong> 12 months
              from issue (ADR-0004). It does <strong>not</strong> touch the cashable bucket.
              Recorded in the audit log.
            </>
          ) : (
            <>
              This grants real money to the Customer&apos;s <strong>Refund balance</strong>{' '}
              bucket — a cashable liability with no expiry. Recorded in the audit log.
            </>
          )
        }
      >
        <p className="text-center text-xs text-muted-foreground">
          Lands in: <strong>{bucketLabel}</strong>
        </p>
      </ConfirmMoneyDialog>
    </>
  )
}
