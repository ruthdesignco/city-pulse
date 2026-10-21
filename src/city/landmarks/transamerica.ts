// The Transamerica Pyramid (1972, 600 Montgomery St): a four-sided pyramid
// of pale crushed-quartz concrete, 48 floors to about 212 m, then a hollow
// spire to 260 m; from the 29th floor two vertical "wings" stand out from
// the sloping east and west faces (elevators east, stairs and a smoke tower
// west) and rise past the top floor. No logos.
//
// Sized from its OSM footprint (the base square, ~53 m a side) and the
// published heights (English Wikipedia, checked 2026-10-21): top floor
// ~212 m and ~14 m (45 ft) across, wings from the 29th floor, spire tip
// 260 m. The base's sloped arcade is a darker band.

import type { LandmarkPlacement } from './registry.ts'
import { Glow, ModelBuilder, type V3, rect } from './build.ts'

const STONE = '#e3ded3' // crushed quartz: the city's lightest masonry
const ARCADE = '#b8b3a9'
const SPIRE = '#d0d3d5' // aluminum
const ARCADE_M = 7
const TOP_FLOOR_M = 212
const TOP_SIDE_M = 13.7
const ROOF_TOP_M = 222
const SPIRE_BASE_HALF_M = 3
const SPIRE_TIP_M = 260
const WING_FROM_M = 113 // the 29th floor
const WING_TOP_M = 229
const WING_ROOF_DROP_M = 4 // its roof slopes down toward the spire
const WING_HALF_DEPTH_M = 6 // along local z

export function buildTransamerica(at: LandmarkPlacement): ModelBuilder {
  const m = new ModelBuilder()
  const base = Math.min(60, Math.max(40, Math.min(at.sizeX, at.sizeZ)))
  const half = (y: number) => (base + ((TOP_SIDE_M - base) * y) / TOP_FLOOR_M) / 2

  // The arcade, then the body to the top floor.
  m.loft(rect(half(0), half(0), 0), rect(half(ARCADE_M), half(ARCADE_M), ARCADE_M), ARCADE)
  m.loft(rect(half(ARCADE_M), half(ARCADE_M), ARCADE_M), rect(half(TOP_FLOOR_M), half(TOP_FLOOR_M), TOP_FLOOR_M), STONE, Glow.Windows)
  // A short roof pyramid, then the spire.
  m.loft(rect(half(TOP_FLOOR_M), half(TOP_FLOOR_M), TOP_FLOOR_M), rect(SPIRE_BASE_HALF_M, SPIRE_BASE_HALF_M, ROOF_TOP_M), STONE)
  const tip: V3 = [0, SPIRE_TIP_M, 0]
  const sb = rect(SPIRE_BASE_HALF_M, SPIRE_BASE_HALF_M, ROOF_TOP_M)
  for (let i = 0; i < 4; i++) m.face([sb[i], sb[(i + 1) % 4], tip], SPIRE)

  // The wings: outer face plumb at the face's width where they begin, the
  // inner edge along the sloping face, then standing free above the roof.
  for (const side of [1, -1]) {
    const h0 = half(WING_FROM_M)
    const hTop = half(TOP_FLOOR_M)
    // Outline in (x, y), counterclockwise seen from +z for the east wing.
    const outline: [number, number][] = [
      [h0, WING_FROM_M],
      [h0, WING_TOP_M],
      [hTop, WING_TOP_M - WING_ROOF_DROP_M],
      [hTop, TOP_FLOOR_M],
    ].map(([x, y]) => [side * x, y] as [number, number])
    const d = WING_HALF_DEPTH_M
    const front = outline.map(([x, y]) => [x, y, d] as V3)
    const back = outline.map(([x, y]) => [x, y, -d] as V3)
    // Seen from +z the east wing's outline runs counterclockwise; mirrored, clockwise.
    m.face(side > 0 ? front : [...front].reverse(), STONE)
    m.face(side > 0 ? [...back].reverse() : back, STONE)
    for (let i = 0; i < 3; i++) {
      // Outer face, roof, inner face above the roof (the edge along the body is inside it).
      const [a, b] = [outline[i], outline[i + 1]]
      const quad: V3[] = [
        [a[0], a[1], d],
        [a[0], a[1], -d],
        [b[0], b[1], -d],
        [b[0], b[1], d],
      ]
      m.face(side > 0 ? quad : [...quad].reverse(), STONE)
    }
  }
  return m
}
