'use client'

import { useRouter } from 'next/navigation'

import {
  ListingFormStepper,
  toStructuredSubmitFields,
  type ListingFormValues,
} from '../listing-form-stepper'
import { createExperienceAction } from './actions'

const DRAFT_KEY = 'outvers:vendor-listing-new-draft'

const INITIAL_VALUES: ListingFormValues = {
  title: '',
  shortDescription: '',
  longDescription: '',
  activity: '',
  region: '',
  price12: '',
  price35: '',
  price6: '',
  cancellationPreset: 'flexible',
  paymentModes: ['full_upfront', 'partial_pay'],
  isCombo: false,
  requiredPermits: [],
  requiresSafetyStack: false,
  // ADR-0017 structured attributes (issue 05).
  difficulty: '',
  durationMinutes: '',
  minAge: '',
  maxGroupSize: '',
  languages: [],
  meetingPoint: '',
  seasonMonths: [],
  highlights: [],
  inclusions: [],
  exclusions: [],
  whatToBring: [],
  itinerary: [],
}

export default function NewListingPage() {
  const router = useRouter()

  async function handleSubmit(values: ListingFormValues) {
    const structured = toStructuredSubmitFields(values)
    const result = await createExperienceAction({
      title: values.title,
      shortDescription: values.shortDescription || null,
      activitySlug: values.activity,
      regionSlug: values.region,
      pricePerPerson_1_2: Number(values.price12),
      pricePerPerson_3_5: values.price35 ? Number(values.price35) : undefined,
      pricePerPerson_6_plus: values.price6 ? Number(values.price6) : undefined,
      cancellationPreset: values.cancellationPreset as 'flexible' | 'moderate' | 'strict',
      ...structured,
    })

    if (!result.ok) {
      return { ok: false as const, error: result.error }
    }

    // The create action persists as a draft; navigate to the listings index.
    router.push('/vendor/listings')
    return { ok: true as const }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-[family-name:var(--font-heading)] text-2xl font-semibold tracking-tight">
          Create listing
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Add a new experience to your portfolio.
        </p>
      </div>

      <ListingFormStepper
        mode="create"
        initialValues={INITIAL_VALUES}
        onSubmit={handleSubmit}
        draftKey={DRAFT_KEY}
        submitLabel="Create listing"
        submitLabelBusy="Creating…"
      />
    </div>
  )
}
