const ACTIVITY_IMAGES: Record<string, string> = {
  rafting:
    'https://images.unsplash.com/photo-1530866495561-507c9faab2ed?w=800&h=600&fit=crop&q=80',
  kayaking:
    'https://images.unsplash.com/photo-1472745942893-4b9f730c7668?w=800&h=600&fit=crop&q=80',
  trekking:
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=600&fit=crop&q=80',
  paragliding:
    'https://images.unsplash.com/photo-1503097581674-a2dcc178922f?w=800&h=600&fit=crop&q=80',
  scuba:
    'https://images.unsplash.com/photo-1583364512105-951b6f7080ae?w=800&h=600&fit=crop&q=80',
  'scuba-diving':
    'https://images.unsplash.com/photo-1583364512105-951b6f7080ae?w=800&h=600&fit=crop&q=80',
  camping:
    'https://images.unsplash.com/photo-1504280390367-361c6d9f38f4?w=800&h=600&fit=crop&q=80',
  bungee:
    'https://images.unsplash.com/photo-1567604528969-2f9ffd981816?w=800&h=600&fit=crop&q=80',
  skiing:
    'https://images.unsplash.com/photo-1551524559-8af4e6624178?w=800&h=600&fit=crop&q=80',
  surfing:
    'https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=800&h=600&fit=crop&q=80',
  canyoning:
    'https://images.unsplash.com/photo-1545558014-8692077e9b5c?w=800&h=600&fit=crop&q=80',
}

const REGION_IMAGES: Record<string, string> = {
  rishikesh:
    'https://images.unsplash.com/photo-1609766856923-7e0a66d63d72?w=800&h=600&fit=crop&q=80',
  manali:
    'https://images.unsplash.com/photo-1626621341517-bbf3d9990a23?w=800&h=600&fit=crop&q=80',
  'bir-billing':
    'https://images.unsplash.com/photo-1503097581674-a2dcc178922f?w=800&h=600&fit=crop&q=80',
  goa:
    'https://images.unsplash.com/photo-1512343879784-a960bf40e7f2?w=800&h=600&fit=crop&q=80',
  ladakh:
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=600&fit=crop&q=80',
  sikkim:
    'https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=800&h=600&fit=crop&q=80',
  kerala:
    'https://images.unsplash.com/photo-1602216056096-3b40cc0c9944?w=800&h=600&fit=crop&q=80',
  meghalaya:
    'https://images.unsplash.com/photo-1593693397690-362cb9666fc2?w=800&h=600&fit=crop&q=80',
  andaman:
    'https://images.unsplash.com/photo-1559494007-9f5847c49d94?w=800&h=600&fit=crop&q=80',
  coorg:
    'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=600&fit=crop&q=80',
}

const HERO_IMAGE =
  'https://images.unsplash.com/photo-1530866495561-507c9faab2ed?w=1600&h=900&fit=crop&q=80'

export function getActivityImage(activitySlug: string): string {
  return ACTIVITY_IMAGES[activitySlug] ?? ACTIVITY_IMAGES.trekking
}

export function getRegionImage(regionSlug: string): string {
  return REGION_IMAGES[regionSlug] ?? REGION_IMAGES.rishikesh
}

export function getHeroImage(): string {
  return HERO_IMAGE
}
