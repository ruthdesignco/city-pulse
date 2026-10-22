// Bucket an OSM building into one of three color families for the tiles'
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

// Most buildings carry no usable `building` tag value (92% of this bake's
// buildings land in Neutral), so without this they're all one flat grey.
// A deterministic per-building hash picks 1 of 3 shade variants within
// whichever family colorType already assigned (Buildings.tsx's shader:
// family*3 + variant indexes a 9-color array) -- hashed from the OSM id,
// not array position, so a building's shade doesn't shuffle on a rebake
// just because a neighboring building was added or dropped.
export function buildingVariant(osmId: string): number {
  let h = 2166136261 // FNV-1a offset basis
  for (let i = 0; i < osmId.length; i++) {
    h ^= osmId.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 3
}
