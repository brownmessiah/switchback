'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'

import { createVendorProfileAction } from './actions'

type Step = 1 | 2 | 3

interface OnboardingFormProps {
  userId: string
}

export function OnboardingForm({ userId }: OnboardingFormProps) {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [businessName, setBusinessName] = useState('')
  const [slug, setSlug] = useState('')
  const [pan, setPan] = useState('')
  const [about, setAbout] = useState('')

  const progress = ((step - 1) / 2) * 100

  function handleBusinessNameChange(value: string) {
    setBusinessName(value)
    setSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .slice(0, 50),
    )
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
        return
      }
      router.push('/vendor/dashboard')
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <Progress value={progress} className="h-2" />

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Business details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">outvers.in/vendor/</span>
                <Input
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                  placeholder="himalayan-adventures"
                  required
                />
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
            <CardTitle>Verification (optional for demo)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="pan">PAN number</Label>
              <Input
                id="pan"
                value={pan}
                onChange={(e) => setPan(e.target.value.toUpperCase().slice(0, 10))}
                placeholder="ABCDE1234F"
                maxLength={10}
              />
              <p className="text-xs text-muted-foreground">
                Required for Identity verification (Tier 2). Optional for demo.
              </p>
            </div>

            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm text-muted-foreground">
                Aadhaar verification and document upload will be available when
                external services are connected.
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
            <CardTitle>Confirm & create profile</CardTitle>
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
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
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
