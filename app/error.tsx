'use client'

import { Button } from '@/components/ui/button'

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <h1 className="text-4xl font-semibold">Something went wrong</h1>
      <p className="mt-4 text-muted-foreground">
        An unexpected error occurred. Please try again.
      </p>
      <Button onClick={reset} className="mt-6">
        Try again
      </Button>
    </main>
  )
}
