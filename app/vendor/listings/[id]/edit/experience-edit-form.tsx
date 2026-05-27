'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'

import { ImageUpload, type UploadedImage } from '@/components/image-upload'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { Experience } from '@/db/schema/experiences'

import {
  deleteExperienceImageAction,
  updateExperienceAction,
  uploadExperienceImageAction,
} from './actions'

// ── Static options ───────────────────────────────────────────────

const ACTIVITIES = [
  { value: 'rafting', label: 'Rafting' },
  { value: 'paragliding', label: 'Paragliding' },
  { value: 'trekking', label: 'Trekking' },
  { value: 'scuba', label: 'Scuba diving' },
  { value: 'camping', label: 'Camping' },
  { value: 'kayaking', label: 'Kayaking' },
  { value: 'bungee', label: 'Bungee jumping' },
  { value: 'skiing', label: 'Skiing' },
  { value: 'surfing', label: 'Surfing' },
  { value: 'canyoning', label: 'Canyoning' },
]

const REGIONS = [
  { value: 'rishikesh', label: 'Rishikesh' },
  { value: 'manali', label: 'Manali' },
  { value: 'bir-billing', label: 'Bir Billing' },
  { value: 'goa', label: 'Goa' },
  { value: 'ladakh', label: 'Ladakh' },
  { value: 'sikkim', label: 'Sikkim' },
  { value: 'kerala', label: 'Kerala' },
  { value: 'meghalaya', label: 'Meghalaya' },
  { value: 'andaman', label: 'Andaman' },
  { value: 'coorg', label: 'Coorg' },
]

const PAYMENT_MODES = [
  { value: 'full_upfront', label: 'Full upfront' },
  { value: 'partial_pay', label: 'Partial pay' },
] as const

const PERMITS = [
  'forest_department',
  'wildlife_clearance',
  'district_admin',
  'noc_local_body',
  'adventure_sports_license',
] as const

// ── Component ────────────────────────────────────────────────────

interface ExperienceEditFormProps {
  experience: Experience
  initialImages: readonly UploadedImage[]
}

export function ExperienceEditForm({ experience, initialImages }: ExperienceEditFormProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [images, setImages] = useState<UploadedImage[]>([...initialImages])

  // Form state
  const [title, setTitle] = useState(experience.title)
  const [shortDescription, setShortDescription] = useState(experience.shortDescription ?? '')
  const [longDescription, setLongDescription] = useState(experience.longDescription ?? '')
  const [activity, setActivity] = useState(experience.activitySlug)
  const [region, setRegion] = useState(experience.regionSlug)
  const [price12, setPrice12] = useState(experience.pricePerPerson_1_2)
  const [price35, setPrice35] = useState(experience.pricePerPerson_3_5)
  const [price6, setPrice6] = useState(experience.pricePerPerson_6_plus)
  const [cancellationPreset, setCancellationPreset] = useState(experience.cancellationPreset)
  const [paymentModes, setPaymentModes] = useState<string[]>(experience.paymentModesAllowed)
  const [isCombo, setIsCombo] = useState(experience.isCombo)
  const [requiredPermits, setRequiredPermits] = useState<string[]>(experience.requiredPermits)
  const [requiresSafetyStack, setRequiresSafetyStack] = useState(experience.requiresSafetyStack)

  const handlePaymentModeToggle = (mode: string) => {
    setPaymentModes((prev) =>
      prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode],
    )
  }

  const handlePermitToggle = (permit: string) => {
    setRequiredPermits((prev) =>
      prev.includes(permit) ? prev.filter((p) => p !== permit) : [...prev, permit],
    )
  }

  const handleImageUpload = useCallback(
    async (file: File): Promise<UploadedImage | null> => {
      const formData = new FormData()
      formData.set('file', file)
      formData.set('experienceId', experience.id)
      const result = await uploadExperienceImageAction(formData)
      if (result.ok) {
        const newImage = { id: result.asset.id, url: result.asset.url, storageKey: result.asset.storageKey }
        setImages((prev) => [...prev, newImage])
        return newImage
      }
      return null
    },
    [experience.id],
  )

  const handleImageDelete = useCallback(async (id: string): Promise<boolean> => {
    const result = await deleteExperienceImageAction(id)
    if (result.ok) {
      setImages((prev) => prev.filter((img) => img.id !== id))
      return true
    }
    return false
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess(false)
    setLoading(true)

    try {
      const result = await updateExperienceAction({
        id: experience.id,
        title,
        shortDescription: shortDescription || null,
        longDescription: longDescription || null,
        activitySlug: activity,
        regionSlug: region,
        pricePerPerson_1_2: Number(price12),
        pricePerPerson_3_5: Number(price35),
        pricePerPerson_6_plus: Number(price6),
        cancellationPreset: cancellationPreset as 'flexible' | 'moderate' | 'strict' | 'custom',
        paymentModesAllowed: paymentModes as ('full_upfront' | 'partial_pay' | 'reserve_now_pay_later')[],
        isCombo,
        requiredPermits,
        requiresSafetyStack,
      })

      if (!result.ok) {
        setError(result.error)
        return
      }

      setSuccess(true)
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Details */}
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Experience title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. White Water Rafting -- 16km stretch"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="shortDescription">Short description</Label>
            <Textarea
              id="shortDescription"
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              placeholder="Brief summary for listing cards..."
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="longDescription">Long description</Label>
            <Textarea
              id="longDescription"
              value={longDescription}
              onChange={(e) => setLongDescription(e.target.value)}
              placeholder="Full details: what's included, difficulty level, itinerary..."
              rows={6}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Activity</Label>
              <Select value={activity} onValueChange={(v) => setActivity(v ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Select activity" />
                </SelectTrigger>
                <SelectContent>
                  {ACTIVITIES.map((a) => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Region</Label>
              <Select value={region} onValueChange={(v) => setRegion(v ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Select region" />
                </SelectTrigger>
                <SelectContent>
                  {REGIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Images */}
      <Card>
        <CardHeader>
          <CardTitle>Images</CardTitle>
        </CardHeader>
        <CardContent>
          <ImageUpload
            images={images}
            onUpload={handleImageUpload}
            onDelete={handleImageDelete}
            maxImages={10}
          />
        </CardContent>
      </Card>

      {/* Pricing */}
      <Card>
        <CardHeader>
          <CardTitle>Pricing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="price12">1-2 guests (INR)</Label>
              <Input
                id="price12"
                type="number"
                value={price12}
                onChange={(e) => setPrice12(e.target.value)}
                min={1}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price35">3-5 guests (INR)</Label>
              <Input
                id="price35"
                type="number"
                value={price35}
                onChange={(e) => setPrice35(e.target.value)}
                min={1}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="price6">6+ guests (INR)</Label>
              <Input
                id="price6"
                type="number"
                value={price6}
                onChange={(e) => setPrice6(e.target.value)}
                min={1}
                required
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cancellation policy */}
      <Card>
        <CardHeader>
          <CardTitle>Cancellation policy</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={cancellationPreset} onValueChange={(v) => setCancellationPreset(v as 'flexible' | 'moderate' | 'strict' | 'custom')}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="flexible">
                Flexible -- free cancellation up to 24h before
              </SelectItem>
              <SelectItem value="moderate">
                Moderate -- free cancellation up to 7 days before
              </SelectItem>
              <SelectItem value="strict">
                Strict -- 50% refund up to 7 days before
              </SelectItem>
              <SelectItem value="custom">
                Custom -- requires admin approval
              </SelectItem>
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Payment modes */}
      <Card>
        <CardHeader>
          <CardTitle>Payment modes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {PAYMENT_MODES.map((mode) => (
              <label key={mode.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={paymentModes.includes(mode.value)}
                  onChange={() => handlePaymentModeToggle(mode.value)}
                  className="rounded border-input"
                />
                {mode.label}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Combo / Safety / Permits */}
      <Card>
        <CardHeader>
          <CardTitle>Additional settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isCombo}
              onChange={(e) => setIsCombo(e.target.checked)}
              className="rounded border-input"
            />
            Combo experience (bundles multiple activities)
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requiresSafetyStack}
              onChange={(e) => setRequiresSafetyStack(e.target.checked)}
              className="rounded border-input"
            />
            Requires safety stack
          </label>

          <div className="space-y-2">
            <Label>Required permits</Label>
            <div className="space-y-2">
              {PERMITS.map((permit) => (
                <label key={permit} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={requiredPermits.includes(permit)}
                    onChange={() => handlePermitToggle(permit)}
                    className="rounded border-input"
                  />
                  {permit.replace(/_/g, ' ')}
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status messages */}
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
      {success && (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-4">
          <p className="text-sm text-green-700 dark:text-green-400">Experience updated.</p>
        </div>
      )}

      <Button type="submit" className="w-full" size="lg" disabled={loading}>
        {loading ? 'Saving...' : 'Save changes'}
      </Button>
    </form>
  )
}
