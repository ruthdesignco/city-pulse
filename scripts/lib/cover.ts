// Ground cover from OpenStreetMap, for what the ground shows where it
// isn't paved (src/city/Ground.tsx): parks and lawns, woods and scrub,
// bare rock and cliffs, sand. The bake (bake-city.ts) keeps these areas
// (and cliffs, which OSM draws as lines along their top edge, widened to
// CLIFF_WIDTH_M) in the tiles' cover section.

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
  // Kept only inside the wooded parks (bake-city.ts bakeCover), where they
  // stay clear of the trees.
  ['natural', 'water', CoverClass.Water],
  ['leisure', 'pitch', CoverClass.Field],
  ['leisure', 'golf_course', CoverClass.Field],
  ['leisure', 'track', CoverClass.Field],
  ['leisure', 'playground', CoverClass.Clear],
  ['leisure', 'stadium', CoverClass.Clear],
  ['leisure', 'sports_centre', CoverClass.Clear],
  ['amenity', 'parking', CoverClass.Clear],
]

// What's only kept inside the wooded parks.
export const PARK_ONLY = new Set<number>([CoverClass.Water, CoverClass.Field, CoverClass.Clear])

// Parks whose real cover is mostly trees, though OSM tags only patches of
// them as woods: their untagged land (and their gardens) is wooded (Park),
// all but their meadows, lawns, water and fields. Golden Gate Park is 407 ha
// with 12 ha tagged as woods. Not every large park: Fort Mason's Great
// Meadow, Candlestick Point, Bernal Heights and most of McLaren are open.
export const WOODED_PARKS = new Map([
  ['way/158602261', 'Golden Gate Park'],
  ['way/103637554', 'Sigmund Stern Recreation Grove'],
  ['way/103637565', 'Pine Lake Park'],
  ['relation/16800880', 'Mount Davidson Park'],
  ['way/7459901', 'Buena Vista Park'],
])

// Its cover class, or null for anything else.
export function coverClass(tags: Record<string, string> | undefined): CoverClass | null {
  if (!tags) return null
  for (const [k, v, c] of BY_TAG) if (tags[k] === v) return c
  return null
}

// OSM draws a cliff as a line along its top, the face to its right.
export const CLIFF_WIDTH_M = 8
export const isCliff = (tags: Record<string, string> | undefined) => tags?.natural === 'cliff'

// Where trees stand in a tile's cover (rings x, z interleaved by `counts`):
// in OSM's woods, or in a wooded park's land clear of what stays open there
// (any other cover: meadows, lawns, water, fields, sand, rock).
export function woodedTest(cover: { counts: Uint16Array; coords: Float32Array; classes: Uint8Array }): (x: number, z: number) => boolean {
  const rings: { cls: number; pts: [number, number][]; box: [number, number, number, number] }[] = []
  let c = 0
  cover.counts.forEach((n, k) => {
    const pts: [number, number][] = []
    for (let i = 0; i < n; i++, c += 2) pts.push([cover.coords[c], cover.coords[c + 1]])
    const xs = pts.map((p) => p[0])
    const zs = pts.map((p) => p[1])
    rings.push({ cls: cover.classes[k], pts, box: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)] })
  })
  const inside = (r: (typeof rings)[number], x: number, z: number) => {
    if (x < r.box[0] || x > r.box[2] || z < r.box[1] || z > r.box[3]) return false
    let hit = false
    for (let i = 0, j = r.pts.length - 1; i < r.pts.length; j = i++) {
      const [xi, zi] = r.pts[i]
      const [xj, zj] = r.pts[j]
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit
    }
    return hit
  }
  return (x, z) => {
    let park = false
    let open = false
    for (const r of rings) {
      if (!inside(r, x, z)) continue
      if (r.cls === CoverClass.Wood) return true
      if (r.cls === CoverClass.Park) park = true
      else open = true
    }
    return park && !open
  }
}
