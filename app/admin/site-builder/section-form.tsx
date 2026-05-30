'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { SiteSection } from '@/db/schema/site-content'

import { saveSection } from './actions'
import type { SaveSectionInput, SiteBuilderResult } from './schema'

// ── Field definitions per section ──────────────────────────────────

interface FieldDef {
  readonly name: string
  readonly label: string
  readonly type: 'text' | 'textarea' | 'url' | 'boolean' | 'color'
  readonly required?: boolean
  readonly placeholder?: string
}

const SECTION_FIELDS: Record<SiteSection, readonly FieldDef[]> = {
  hero: [
    { name: 'title', label: 'Title', type: 'text', required: true, placeholder: 'Welcome to Outvers' },
    { name: 'subtitle', label: 'Subtitle', type: 'text', placeholder: 'Adventure awaits' },
    { name: 'ctaText', label: 'CTA Button Text', type: 'text', placeholder: 'Explore Now' },
    { name: 'ctaLink', label: 'CTA Link', type: 'url', placeholder: '/experiences' },
    { name: 'backgroundImageUrl', label: 'Background Image URL', type: 'url', placeholder: 'https://...' },
  ],
  announcement_bar: [
    { name: 'text', label: 'Announcement Text', type: 'text', placeholder: 'Limited-time offer!' },
    { name: 'linkText', label: 'Link Text', type: 'text', placeholder: 'Learn more' },
    { name: 'linkUrl', label: 'Link URL', type: 'url', placeholder: '/offers' },
    { name: 'enabled', label: 'Enabled', type: 'boolean' },
    { name: 'backgroundColor', label: 'Background Color', type: 'color', placeholder: '#FF5A5F' },
  ],
  homepage: [
    { name: 'featuredSectionTitle', label: 'Featured Section Title', type: 'text', placeholder: 'Popular Experiences' },
    { name: 'showCategories', label: 'Show Categories', type: 'boolean' },
    { name: 'showTestimonials', label: 'Show Testimonials', type: 'boolean' },
  ],
  branding: [
    { name: 'siteName', label: 'Site Name', type: 'text', placeholder: 'Outvers' },
    { name: 'logoUrl', label: 'Logo URL', type: 'url', placeholder: 'https://...' },
    { name: 'faviconUrl', label: 'Favicon URL', type: 'url', placeholder: 'https://...' },
    { name: 'primaryColor', label: 'Primary Color', type: 'color', placeholder: '#FF5A5F' },
  ],
  seo: [
    { name: 'defaultTitle', label: 'Default Page Title', type: 'text', placeholder: 'Outvers — Adventure Awaits' },
    { name: 'titleTemplate', label: 'Title Template', type: 'text', placeholder: '%s | Outvers' },
    { name: 'defaultDescription', label: 'Default Description', type: 'textarea', placeholder: 'Discover and book outdoor adventures...' },
    { name: 'ogImageUrl', label: 'Default OG Image URL', type: 'url', placeholder: 'https://...' },
    { name: 'robots', label: 'Robots Meta', type: 'text', placeholder: 'index, follow' },
  ],
  footer: [
    { name: 'companyName', label: 'Company Name', type: 'text', placeholder: 'Outvers' },
    { name: 'copyrightText', label: 'Copyright Text', type: 'text', placeholder: '2026 Outvers. All rights reserved.' },
  ],
}

const SECTION_LABELS: Record<SiteSection, string> = {
  hero: 'Hero',
  announcement_bar: 'Announcement Bar',
  homepage: 'Homepage',
  branding: 'Branding',
  seo: 'SEO',
  footer: 'Footer',
}

// ── Component ──────────────────────────────────────────────────────

interface SectionFormProps {
  readonly section: SiteSection
  readonly initialValues: Record<string, unknown>
  readonly currentVersion: number | null
}

export function SectionForm({ section, initialValues, currentVersion }: SectionFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(initialValues)
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<SiteBuilderResult | null>(null)

  const fields = SECTION_FIELDS[section]

  function handleChange(name: string, value: unknown) {
    setValues((prev) => ({ ...prev, [name]: value }))
  }

  function handleSubmit() {
    setResult(null)
    startTransition(async () => {
      // Strip empty strings for optional URL fields to avoid validation errors
      const cleaned: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(values)) {
        const field = fields.find((f) => f.name === k)
        if (field?.type === 'url' && v === '') {
          cleaned[k] = null
        } else if (v !== '' && v !== undefined) {
          cleaned[k] = v
        }
      }

      const input: SaveSectionInput = {
        section,
        key: 'default',
        value: cleaned,
      }

      const res = await saveSection(input)
      setResult(res)
    })
  }

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{SECTION_LABELS[section]}</h3>
          {currentVersion !== null && (
            <span className="text-xs text-muted-foreground">v{currentVersion}</span>
          )}
        </div>

        {fields.map((field) => (
          <div key={field.name} className="space-y-1.5">
            <Label htmlFor={`${section}-${field.name}`}>
              {field.label}
              {field.required && <span className="text-destructive"> *</span>}
            </Label>

            {field.type === 'boolean' ? (
              <div className="flex items-center gap-2">
                <input
                  id={`${section}-${field.name}`}
                  type="checkbox"
                  checked={Boolean(values[field.name])}
                  onChange={(e) => handleChange(field.name, e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm text-muted-foreground">
                  {Boolean(values[field.name]) ? 'Enabled' : 'Disabled'}
                </span>
              </div>
            ) : field.type === 'textarea' ? (
              <Textarea
                id={`${section}-${field.name}`}
                value={String(values[field.name] ?? '')}
                onChange={(e) => handleChange(field.name, e.target.value)}
                placeholder={field.placeholder}
                rows={3}
              />
            ) : field.type === 'color' ? (
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={String(values[field.name] || '#000000')}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  className="h-9 w-9 rounded border p-0.5"
                />
                <Input
                  id={`${section}-${field.name}`}
                  value={String(values[field.name] ?? '')}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  placeholder={field.placeholder}
                  className="flex-1"
                />
              </div>
            ) : (
              <Input
                id={`${section}-${field.name}`}
                type={field.type === 'url' ? 'url' : 'text'}
                value={String(values[field.name] ?? '')}
                onChange={(e) => handleChange(field.name, e.target.value)}
                placeholder={field.placeholder}
              />
            )}
          </div>
        ))}

        <div className="flex items-center gap-3 pt-2">
          <Button onClick={handleSubmit} disabled={isPending} size="sm">
            {isPending ? 'Saving...' : 'Save Section'}
          </Button>

          {result && !isPending && (
            <span
              className={`text-sm ${
                result.ok ? 'text-green-600' : 'text-destructive'
              }`}
            >
              {result.ok
                ? `Saved (v${result.version})`
                : result.error}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
