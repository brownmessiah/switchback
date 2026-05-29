'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { updateBusinessDetailsAction } from './actions'

interface BusinessDetailsFormProps {
  initialBusinessName: string
  initialSlug: string
  initialAbout: string | null
}

export function BusinessDetailsForm({
  initialBusinessName,
  initialSlug,
  initialAbout,
}: BusinessDetailsFormProps) {
  const [businessName, setBusinessName] = useState(initialBusinessName)
  const [slug, setSlug] = useState(initialSlug)
  const [about, setAbout] = useState(initialAbout ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess(false)
    setLoading(true)

    try {
      const result = await updateBusinessDetailsAction({
        businessName,
        slug,
        about: about.trim() || null,
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
        <CardTitle>Business details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="businessName">Business name</Label>
            <Input
              id="businessName"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="e.g. Himalayan Adventures"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="slug">Profile URL</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                outvers.in/vendor/
              </span>
              <Input
                id="slug"
                value={slug}
                onChange={(e) =>
                  setSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, ''),
                  )
                }
                placeholder="himalayan-adventures"
                required
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Only lowercase letters, numbers, and hyphens.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="about">About your business</Label>
            <Textarea
              id="about"
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              placeholder="Tell potential customers about your experience running adventures..."
              rows={4}
              maxLength={2000}
            />
            <p className="text-xs text-muted-foreground">
              {about.length}/2000 characters
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {success && (
            <div className="rounded-lg border border-green-500/30 bg-green-50 p-3 dark:bg-green-950/20">
              <p className="text-sm text-green-700 dark:text-green-400">
                Business details updated.
              </p>
            </div>
          )}

          <Button type="submit" disabled={loading || !businessName || !slug}>
            {loading ? 'Saving...' : 'Save changes'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
