// Bucket an OSM building into one of three color families for city.bin's
// `colorType` byte (format.ts), read by Buildings.tsx's shader
// (palette.ts): cream/sandstone/pastel residential, gray/glass towers (by
// height, regardless of tag), everything else the existing neutral grey.
// Not architecturally exhaustive -- OSM's `building` tag is inconsistent
// and often just "yes" -- subtle variety, not a rainbow.

export const BuildingColorType = {
  Neutral: 0,
  Residential: 1,
  Tower: 2,
} as const

const RESIDENTIAL_VALUES = new Set([
  'apartments',
  'house',
  'residential',
  'terrace',
  'semidetached_house',
  'bungalow',
  'dormitory',
  'detached',
  'houseboat',
  'static_caravan',
])

// Skyline-scale: skews glass/gray regardless of the building tag.
const TOWER_HEIGHT_M = 60

export function buildingColorType(buildingTag: string | undefined, heightM: number): number {
  if (heightM >= TOWER_HEIGHT_M) return BuildingColorType.Tower
  if (buildingTag && RESIDENTIAL_VALUES.has(buildingTag)) return BuildingColorType.Residential
  return BuildingColorType.Neutral
}
