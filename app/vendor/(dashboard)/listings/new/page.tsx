'use client'

import { useRouter } from 'next/navigation'

import {
  ListingFormStepper,
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
}

export default function NewListingPage() {
  const router = useRouter()

  async function handleSubmit(values: ListingFormValues) {
    const result = await createExperienceAction({
      title: values.title,
      shortDescription: values.shortDescription,
      activitySlug: values.activity,
      regionSlug: values.region,
      pricePerPerson_1_2: Number(values.price12),
      pricePerPerson_3_5: Number(values.price35 || values.price12),
      pricePerPerson_6_plus: Number(values.price6 || values.price35 || values.price12),
      cancellationPreset: values.cancellationPreset as 'flexible' | 'moderate' | 'strict',
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
