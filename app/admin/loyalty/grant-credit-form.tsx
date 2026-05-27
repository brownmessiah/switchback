'use client'

import { useRef, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { adminGrantCredit, type GrantCreditResult } from './actions'

export function GrantCreditForm() {
  const formRef = useRef<HTMLFormElement>(null)
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<GrantCreditResult | null>(null)

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await adminGrantCredit(formData)
      setResult(res)
      if (res.ok) {
        formRef.current?.reset()
      }
    })
  }

  return (
    <form ref={formRef} action={handleSubmit} className="space-y-4">
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
  )
}
