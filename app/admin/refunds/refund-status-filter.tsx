'use client'

import { useRouter, useSearchParams } from 'next/navigation'

import { Button } from '@/components/ui/button'

const STATUSES = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'credited', label: 'Credited' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'failed', label: 'Failed' },
] as const

interface RefundStatusFilterProps {
  currentStatus: string | undefined
}

export function RefundStatusFilter({ currentStatus }: RefundStatusFilterProps) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function handleFilter(status: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (status) {
      params.set('status', status)
    } else {
      params.delete('status')
    }
    router.push(`/admin/refunds?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap gap-2">
      {STATUSES.map(({ value, label }) => (
        <Button
          key={value}
          variant={(currentStatus ?? '') === value ? 'default' : 'outline'}
          size="sm"
          onClick={() => handleFilter(value)}
        >
          {label}
        </Button>
      ))}
    </div>
  )
}
