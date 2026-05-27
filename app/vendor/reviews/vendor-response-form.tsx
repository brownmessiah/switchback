'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

import { submitVendorResponseAction } from './actions'

interface VendorResponseFormProps {
  reviewId: string
}

export function VendorResponseForm({ reviewId }: VendorResponseFormProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [responseText, setResponseText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [submitted, setSubmitted] = useState(false)

  if (submitted) {
    return (
      <div className="mt-3 rounded-md border border-border bg-muted/50 px-4 py-3">
        <p className="text-xs font-medium text-muted-foreground">Your response</p>
        <p className="mt-1 text-sm">{responseText}</p>
      </div>
    )
  }

  if (!isOpen) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="mt-2"
        onClick={() => setIsOpen(true)}
      >
        Respond
      </Button>
    )
  }

  function handleSubmit() {
    const trimmed = responseText.trim()
    if (!trimmed) {
      setError('Response text is required.')
      return
    }

    setError(null)
    startTransition(async () => {
      const result = await submitVendorResponseAction({
        reviewId,
        responseText: trimmed,
      })

      if (result.ok) {
        setSubmitted(true)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="mt-3 space-y-2">
      <Textarea
        placeholder="Write your response..."
        value={responseText}
        onChange={(e) => setResponseText(e.target.value)}
        disabled={isPending}
        rows={3}
      />
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={isPending}
        >
          {isPending ? 'Submitting...' : 'Submit Response'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setIsOpen(false)
            setResponseText('')
            setError(null)
          }}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}
