'use client'

import { CheckCircle2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { CustomerAddress } from '@/lib/customer/profile'

import { updateCustomerProfileAction } from './actions'

interface ProfileFormProps {
  initial: {
    displayName: string
    avatarUrl: string
    address: CustomerAddress | null
    trustedContactName: string
    trustedContactPhone: string
    trustedContactRelationship: string
  }
}

/**
 * Customer profile editor form. Calls the `updateCustomerProfileAction`
 * Server Action (auth + pure-core `updateCustomerProfile`) and renders a
 * discriminated success / error state.
 */
export function ProfileForm({ initial }: ProfileFormProps) {
  const t = useTranslations('SettingsPage')
  const [displayName, setDisplayName] = useState(initial.displayName)
  const [avatarUrl, setAvatarUrl] = useState(initial.avatarUrl)
  const [line1, setLine1] = useState(initial.address?.line1 ?? '')
  const [city, setCity] = useState(initial.address?.city ?? '')
  const [stateField, setStateField] = useState(initial.address?.state ?? '')
  const [pincode, setPincode] = useState(initial.address?.pincode ?? '')
  const [contactName, setContactName] = useState(initial.trustedContactName)
  const [contactPhone, setContactPhone] = useState(initial.trustedContactPhone)
  const [contactRelationship, setContactRelationship] = useState(
    initial.trustedContactRelationship,
  )

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    setError('')

    const hasAddress =
      line1.trim() !== '' || city.trim() !== '' || stateField.trim() !== '' || pincode.trim() !== ''

    const result = await updateCustomerProfileAction({
      displayName,
      avatarUrl,
      address: hasAddress
        ? { line1, city, state: stateField, pincode }
        : null,
      trustedContactName: contactName,
      trustedContactPhone: contactPhone,
      trustedContactRelationship: contactRelationship,
    })

    setSaving(false)
    if (result.ok) {
      setSaved(true)
    } else {
      setError(result.error)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" data-testid="profile-form">
      {/* ── Profile ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('profile.heading')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('profile.description')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="displayName">{t('profile.displayName')}</Label>
            <Input
              id="displayName"
              name="displayName"
              data-testid="settings-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('profile.displayNamePlaceholder')}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="avatarUrl">{t('profile.avatarUrl')}</Label>
            <Input
              id="avatarUrl"
              name="avatarUrl"
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder={t('profile.avatarUrlPlaceholder')}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Default address ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('address.heading')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('address.description')}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="line1">{t('address.line1')}</Label>
            <Input
              id="line1"
              name="line1"
              value={line1}
              onChange={(e) => setLine1(e.target.value)}
              placeholder={t('address.line1Placeholder')}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="city">{t('address.city')}</Label>
              <Input id="city" name="city" value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="state">{t('address.state')}</Label>
              <Input
                id="state"
                name="state"
                value={stateField}
                onChange={(e) => setStateField(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pincode">{t('address.pincode')}</Label>
              <Input
                id="pincode"
                name="pincode"
                inputMode="numeric"
                value={pincode}
                onChange={(e) => setPincode(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Trusted contact ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('trustedContact.heading')}</CardTitle>
          <p className="text-sm text-muted-foreground">{t('trustedContact.description')}</p>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="contactName">{t('trustedContact.name')}</Label>
            <Input
              id="contactName"
              name="contactName"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contactPhone">{t('trustedContact.phone')}</Label>
            <Input
              id="contactPhone"
              name="contactPhone"
              type="tel"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="contactRelationship">{t('trustedContact.relationship')}</Label>
            <Input
              id="contactRelationship"
              name="contactRelationship"
              value={contactRelationship}
              onChange={(e) => setContactRelationship(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-4">
        <Button type="submit" disabled={saving} data-testid="settings-save">
          {saving ? t('saving') : t('save')}
        </Button>
        {saved ? (
          <span
            data-testid="settings-saved"
            role="status"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-success"
          >
            <CheckCircle2 className="size-4" aria-hidden />
            {t('saved')}
          </span>
        ) : null}
        {error ? (
          <span data-testid="settings-error" role="alert" className="text-sm text-destructive">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  )
}
