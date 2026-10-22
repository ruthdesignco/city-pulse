// Sutro Tower (1973), on Mount Sutro: a three-legged steel tower, 298 m to
// the tips of its masts, painted in international orange and white bands.
// The legs lean in from a broad base triangle to a narrow waist, then out
// again to the antenna level, where a mast rises from each leg's top.
//
// Sized from English Wikipedia (checked 2026-10-22): 297.8 m to the
// antenna tips; legs 45.7 m apart at the base, 18.3 m at the waist and
// 30.5 m at the antenna level; the top level (Level 6) 228.8 m up. The waist's
// height isn't published: about 160 m, from photographs. The lattice is
// drawn as solid members, MEMBER_M across: seen from the city, a few
// pixels wide at most.

import type { LandmarkPlacement } from './registry.ts'
import { ModelBuilder, type V3 } from './build.ts'

const ORANGE = '#bf4e3b' // OSM's colour tag
const WHITE = '#e8e6e1'
const MEMBER_M = 4
const MAST_M = [3, 1.6] // a mast's width at its foot and its tip
const WAIST_M = 160
const TOP_M = 228.8
const TIP_M = 297.8
const SIDE_WAIST_M = 18.3
const SIDE_TOP_M = 30.5
// Bands, alternating from orange at the foot, per stretch.
const LEG_LOW_BANDS = 7
const LEG_HIGH_BANDS = 3
const MAST_BANDS = 4
// Horizontal ties between the legs.
const TIES_M = [75, WAIST_M, TOP_M]

type Vec = [number, number, number]
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: Vec): Vec => {
  const l = Math.hypot(...a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const lerp = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

// A square member from a to b, `w0` across at a and `w1` at b, its faces
// outward and its ends capped.
function member(m: ModelBuilder, a: Vec, b: Vec, w0: number, w1: number, color: string) {
  const d = unit(sub(b, a))
  const u = unit(Math.abs(d[1]) > 0.95 ? cross(d, [1, 0, 0]) : cross(d, [0, 1, 0]))
  const v = cross(d, u) // u x v = d: the corners run counterclockwise about d
  const around = (p: Vec, w: number): V3[] =>
    [0, 1, 2, 3].map((k) => {
      const th = Math.PI / 4 + (k * Math.PI) / 2
      const cu = (Math.cos(th) * w) / Math.SQRT2
      const cv = (Math.sin(th) * w) / Math.SQRT2
      return [p[0] + u[0] * cu + v[0] * cv, p[1] + u[1] * cu + v[1] * cv, p[2] + u[2] * cu + v[2] * cv]
    })
  const lo = around(a, w0)
  const hi = around(b, w1)
  m.loft(lo, hi, color)
  m.face(hi, color)
  m.face([...lo].reverse(), color)
}

// A member from a to b in `bands` alternating bands, orange first unless
// `first` is 1.
function banded(m: ModelBuilder, a: Vec, b: Vec, bands: number, w0: number, w1: number, first = 0) {
  for (let k = 0; k < bands; k++) {
    const t0 = k / bands
    const t1 = (k + 1) / bands
    member(m, lerp(a, b, t0), lerp(a, b, t1), w0 + (w1 - w0) * t0, w0 + (w1 - w0) * t1, (k + first) % 2 === 0 ? ORANGE : WHITE)
  }
}

export function buildSutroTower(at: LandmarkPlacement): ModelBuilder {
  const m = new ModelBuilder()
  // The base triangle from the legs' footprints (their minimum rectangle,
  // ~46 m: the published spacing), its legs' centers a member's width in;
  // one side along local x, the far corner toward -z. The tower's axis is
  // the triangle's centroid.
  const side = Math.min(50, Math.max(40, Math.max(at.sizeX, at.sizeZ))) - MEMBER_M
  const axisZ = (side * Math.sqrt(3)) / 2 / 6
  // Leg k's center at height y, on a triangle `s` meters a side.
  const leg = (k: number, s: number, y: number): Vec => {
    const a = -Math.PI / 2 + (k * 2 * Math.PI) / 3 // k = 0: the far corner, toward -z
    const r = s / Math.sqrt(3)
    return [r * Math.cos(a), y, axisZ + r * Math.sin(a)]
  }
  const sideAt = (y: number) => (y <= WAIST_M ? side + ((SIDE_WAIST_M - side) * y) / WAIST_M : SIDE_WAIST_M + ((SIDE_TOP_M - SIDE_WAIST_M) * (y - WAIST_M)) / (TOP_M - WAIST_M))
  for (let k = 0; k < 3; k++) {
    banded(m, leg(k, side, 0), leg(k, SIDE_WAIST_M, WAIST_M), LEG_LOW_BANDS, MEMBER_M, MEMBER_M)
    banded(m, leg(k, SIDE_WAIST_M, WAIST_M), leg(k, SIDE_TOP_M, TOP_M), LEG_HIGH_BANDS, MEMBER_M, MEMBER_M, LEG_LOW_BANDS % 2)
    banded(m, leg(k, SIDE_TOP_M, TOP_M), leg(k, SIDE_TOP_M, TIP_M), MAST_BANDS, MAST_M[0], MAST_M[1], 1)
  }
  for (const y of TIES_M)
    for (let k = 0; k < 3; k++) member(m, leg(k, sideAt(y), y), leg((k + 1) % 3, sideAt(y), y), MEMBER_M * 0.6, MEMBER_M * 0.6, y === TOP_M ? WHITE : ORANGE)
  return m
}
