import { RecentlyViewedRail } from "outvers-next";

// The rail reads recently-viewed slugs from localStorage on mount and hides
// itself when empty (guardrail D0). Seed them at module scope so the slugs exist
// before the component's mount effect runs and fetchCards is invoked.
if (typeof window !== "undefined") {
  window.localStorage.setItem(
    "outvers-recently-viewed",
    JSON.stringify([
      "white-water-rafting-rishikesh-16km",
      "tandem-paragliding-bir-billing",
      "scuba-diving-grande-island-goa",
      "hampta-pass-trek-manali",
    ]),
  );
}

const CARDS = [
  {
    id: "exp_rishikesh_rafting",
    slug: "white-water-rafting-rishikesh-16km",
    title: "White-Water Rafting on the Ganga — 16 km",
    shortDescription:
      "Grade III+ rapids from Shivpuri to Rishikesh with certified river guides and a safety kayak.",
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
  },
  {
    id: "exp_bir_paragliding",
    slug: "tandem-paragliding-bir-billing",
    title: "Tandem Paragliding over Bir Billing",
    shortDescription:
      "A 20–30 minute tandem flight from Asia's highest take-off with a certified pilot.",
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
  },
  {
    id: "exp_goa_scuba",
    slug: "scuba-diving-grande-island-goa",
    title: "Scuba Diving at Grande Island, Goa",
    shortDescription:
      "A guided beginner dive over coral reefs with PADI-certified instructors and full gear.",
    pricePerParticipantRupees: 3200,
    regionSlug: "goa",
    activitySlug: "scuba-diving",
    vendorName: "Blue Coast Divers",
    vendorKycTier: "business" as const,
    coverImageUrl:
      "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=800&q=80",
    difficulty: "easy" as const,
    ratingAvg: 4.7,
    ratingCount: 198,
    cancellationPreset: "flexible" as const,
  },
  {
    id: "exp_manali_trek",
    slug: "hampta-pass-trek-manali",
    title: "Hampta Pass Trek from Manali — 4 days",
    shortDescription:
      "A classic Himalayan crossing from green valleys to the high desert of Lahaul with camp support.",
    pricePerParticipantRupees: 8900,
    regionSlug: "manali",
    activitySlug: "trekking",
    vendorName: "Pir Panjal Treks",
    vendorKycTier: "business" as const,
    coverImageUrl:
      "https://images.unsplash.com/photo-1551632811-561732d1e306?w=800&q=80",
    difficulty: "challenging" as const,
    ratingAvg: 4.9,
    ratingCount: 87,
    highlight: "bestseller" as const,
    cancellationPreset: "moderate" as const,
  },
];

async function fetchCards() {
  return CARDS;
}

export function Rail() {
  return (
    <div style={{ width: 1100, maxWidth: "100%" }}>
      <RecentlyViewedRail fetchCards={fetchCards} />
    </div>
  );
}
