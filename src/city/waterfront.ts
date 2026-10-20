// The waterfront extension: the context ring is 800 m around the three
// neighborhoods, which stops 0.5-1.3 km short of the Bay north and east of
// SoMa. This polygon adds the land between the ring and the water there
// (Financial District, Rincon Hill, South Beach) to the bake area, so the
// skyline runs right down to the Embarcadero. It's part of the ring: same
// fade toward the sky, never the focus. The bake records the outline in
// city.bin's header (`waterfront`), which is what the app reads.
//
// Its east edge sits out over the water so the piers come in whole. Its
// north edge stops at WATERFRONT_NORTH_Z, just short of the Int16 coordinate
// limit in city.bin (32767 x 0.1 m from ORIGIN), around Washington St; going
// further north needs a new ORIGIN or format.

import { toScene } from '../geo/projection.ts'
import type { LatLngPt } from './bay.ts'

export const WATERFRONT_NORTH_Z = -3240

const WATERFRONT: LatLngPt[] = [
  [37.7972, -122.406], // Kearny near Washington (inside the ring)
  [37.7972, -122.389], // out over the water past Pier 1
  [37.792, -122.3855], // off Pier 14
  [37.785, -122.3835], // off Pier 26
  [37.779, -122.3825], // off Pier 30-32
  [37.7755, -122.385], // Mission Creek mouth
  [37.7755, -122.3955], // King and 3rd (inside the ring)
  [37.788, -122.406], // Kearny and Market (inside the ring)
]

// The extension's outline in scene meters, [x, z].
export function waterfrontOutline(): [number, number][] {
  return WATERFRONT.map(([lat, lng]) => {
    const { x, z } = toScene(lat, lng)
    return [x, Math.max(z, WATERFRONT_NORTH_Z)]
  })
}

// Distance (m) from (x, z) to an outline: 0 inside it, Infinity if empty.
export function distToOutline(x: number, z: number, outline: [number, number][]): number {
  let inside = false
  let nearest = Infinity
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [xi, zi] = outline[i]
    const [xj, zj] = outline[j]
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
    const dx = xi - xj
    const dz = zi - zj
    const len2 = dx * dx + dz * dz
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - xj) * dx + (z - zj) * dz) / len2))
    nearest = Math.min(nearest, Math.hypot(x - (xj + t * dx), z - (zj + t * dz)))
  }
  return inside ? 0 : nearest
}
