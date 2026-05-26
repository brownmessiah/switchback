'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

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

import { createExperienceAction } from './actions'

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

export default function NewListingPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [activity, setActivity] = useState('')
  const [region, setRegion] = useState('')
  const [price12, setPrice12] = useState('')
  const [price35, setPrice35] = useState('')
  const [price6, setPrice6] = useState('')
  const [cancellationPreset, setCancellationPreset] = useState('flexible')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const result = await createExperienceAction({
        title,
        shortDescription: description,
        activitySlug: activity,
        regionSlug: region,
        pricePerPerson_1_2: Number(price12),
        pricePerPerson_3_5: Number(price35 || price12),
        pricePerPerson_6_plus: Number(price6 || price35 || price12),
        cancellationPreset: cancellationPreset as 'flexible' | 'moderate' | 'strict',
      })

      if (!result.ok) {
        setError(result.error)
        return
      }

      router.push('/vendor/listings')
      router.refresh()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Create listing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a new experience to your portfolio.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
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
                placeholder="e.g. White Water Rafting — 16km stretch"
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the experience, what's included, difficulty level..."
                rows={4}
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

        <Card>
          <CardHeader>
            <CardTitle>Pricing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="price12">1-2 guests (₹)</Label>
                <Input
                  id="price12"
                  type="number"
                  value={price12}
                  onChange={(e) => setPrice12(e.target.value)}
                  placeholder="2500"
                  min={1}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="price35">3-5 guests (₹)</Label>
                <Input
                  id="price35"
                  type="number"
                  value={price35}
                  onChange={(e) => setPrice35(e.target.value)}
                  placeholder="2000"
                  min={1}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="price6">6+ guests (₹)</Label>
                <Input
                  id="price6"
                  type="number"
                  value={price6}
                  onChange={(e) => setPrice6(e.target.value)}
                  placeholder="1500"
                  min={1}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              If left blank, 3-5 and 6+ prices default to the 1-2 price.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cancellation policy</CardTitle>
          </CardHeader>
          <CardContent>
            <Select value={cancellationPreset} onValueChange={(v) => setCancellationPreset(v ?? 'flexible')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="flexible">
                  Flexible — free cancellation up to 24h before
                </SelectItem>
                <SelectItem value="moderate">
                  Moderate — free cancellation up to 7 days before
                </SelectItem>
                <SelectItem value="strict">
                  Strict — 50% refund up to 7 days before
                </SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <Button type="submit" className="w-full" size="lg" disabled={loading}>
          {loading ? 'Creating...' : 'Create listing'}
        </Button>
      </form>
    </div>
  )
}
