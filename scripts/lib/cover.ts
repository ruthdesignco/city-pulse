// Ground cover from OpenStreetMap, for what the ground shows where it
// isn't paved (src/city/Ground.tsx): parks and lawns, woods and scrub,
// bare rock and cliffs, sand. The bake (bake-city.ts) keeps these areas
// (and cliffs, which OSM draws as lines along their top edge, widened to
// CLIFF_WIDTH_M) in city.bin's cover section.

import { CoverClass } from '../../src/city/format.ts'

const BY_TAG: [string, string, CoverClass][] = [
  ['leisure', 'park', CoverClass.Grass],
  ['leisure', 'garden', CoverClass.Grass],
  ['leisure', 'dog_park', CoverClass.Grass],
  ['landuse', 'grass', CoverClass.Grass],
  ['landuse', 'meadow', CoverClass.Grass],
  ['landuse', 'recreation_ground', CoverClass.Grass],
  ['landuse', 'village_green', CoverClass.Grass],
  ['natural', 'grassland', CoverClass.Grass],
  ['natural', 'heath', CoverClass.Grass],
  ['natural', 'wood', CoverClass.Wood],
  ['natural', 'scrub', CoverClass.Wood],
  ['landuse', 'forest', CoverClass.Wood],
  ['natural', 'bare_rock', CoverClass.Rock],
  ['natural', 'scree', CoverClass.Rock],
  ['natural', 'cliff', CoverClass.Rock],
  ['natural', 'sand', CoverClass.Sand],
  ['natural', 'beach', CoverClass.Sand],
]

// Its cover class, or null for anything else.
export function coverClass(tags: Record<string, string> | undefined): CoverClass | null {
  if (!tags) return null
  for (const [k, v, c] of BY_TAG) if (tags[k] === v) return c
  return null
}

// OSM draws a cliff as a line along its top, the face to its right.
export const CLIFF_WIDTH_M = 8
export const isCliff = (tags: Record<string, string> | undefined) => tags?.natural === 'cliff'
