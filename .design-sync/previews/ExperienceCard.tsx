import { ExperienceCard } from "outvers-next";

const rafting = {
  id: "exp_rishikesh_rafting",
  slug: "white-water-rafting-rishikesh-16km",
  title: "White-Water Rafting on the Ganga — 16 km",
  shortDescription:
    "Grade III+ rapids from Shivpuri to Rishikesh with certified river guides, a safety kayak, and a riverside snack break.",
  pricePerParticipantRupees: 1499,
  fromPriceRupees: 1199,
  regionSlug: "rishikesh",
  activitySlug: "rafting",
  vendorName: "Ganga Adventures",
  vendorKycTier: "business" as const,
  coverImageUrl:
    "https://images.unsplash.com/photo-1530866495561-507c9faab2ed?w=800&q=80",
  isWishlisted: false,
  difficulty: "moderate" as const,
  ratingAvg: 4.8,
  ratingCount: 326,
  highlight: "bestseller" as const,
  cancellationPreset: "flexible" as const,
  requiresSafetyStack: true,
  paymentModesAllowed: ["full_upfront", "partial_pay"] as const,
};

const paragliding = {
  id: "exp_bir_paragliding",
  slug: "tandem-paragliding-bir-billing",
  title: "Tandem Paragliding over Bir Billing",
  shortDescription:
    "A 20–30 minute tandem flight from Asia's highest take-off with a certified pilot and GoPro footage included.",
  pricePerParticipantRupees: 2750,
  regionSlug: "bir-billing",
  activitySlug: "paragliding",
  vendorName: "Himalayan Sky Tours",
  vendorKycTier: "identity" as const,
  coverImageUrl:
    "https://images.unsplash.com/photo-1503480207415-fdaddbb01530?w=800&q=80",
  difficulty: "easy" as const,
  ratingAvg: 4.9,
  ratingCount: 512,
  highlight: "top_rated" as const,
  cancellationPreset: "moderate" as const,
};

export function Grid() {
  return (
    <div style={{ width: 320 }}>
      <ExperienceCard experience={rafting} layout="grid" />
    </div>
  );
}

export function ListRow() {
  return (
    <div style={{ width: 640 }}>
      <ExperienceCard experience={paragliding} layout="list" />
    </div>
  );
}
