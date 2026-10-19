// Route shapes as measured polylines: project a point onto a shape to get its
// distance along it, and go back from a distance to a point.
//
// For a polyline P0..Pn with cumulative lengths L0..Ln and a point q, each
// segment gives t = clamp(((q - Pi) . (Pi+1 - Pi)) / |Pi+1 - Pi|^2, 0, 1);
// the nearest segment's foot Pi + t (Pi+1 - Pi) gives s = Li + t |Pi+1 - Pi|
// (distance along) and d = |q - foot| (distance off the line).

import type { RoutesFile } from './routes-format.ts'

export interface ShapeLine {
  key: string // `${shapeId}#${piece}`
  routeId: string
  direction: 0 | 1 | null
  xz: Float64Array // x0, z0, x1, z1, ... in scene meters
  cum: Float64Array // distance along the line at each vertex
  length: number
}

export type ShapeIndex = Map<string, ShapeLine[]> // by GTFS route_id

export interface Projection {
  s: number
  d: number
  x: number
  z: number
}

export function makeLine(key: string, routeId: string, direction: 0 | 1 | null, coords: ArrayLike<number>): ShapeLine {
  const xz = Float64Array.from(coords)
  const n = xz.length / 2
  const cum = new Float64Array(n)
  for (let i = 1; i < n; i++)
    cum[i] = cum[i - 1] + Math.hypot(xz[2 * i] - xz[2 * i - 2], xz[2 * i + 1] - xz[2 * i - 1])
  return { key, routeId, direction, xz, cum, length: cum[n - 1] ?? 0 }
}

export function buildShapeIndex(file: RoutesFile): ShapeIndex {
  const index: ShapeIndex = new Map()
  for (const route of file.routes) {
    const lines: ShapeLine[] = []
    for (const shape of route.shapes)
      shape.pieces.forEach((piece, k) => {
        const line = makeLine(`${shape.id}#${k}`, route.id, shape.direction, piece.map((v) => v * file.coordQuantum))
        if (line.length > 0) lines.push(line)
      })
    if (lines.length) index.set(route.id, lines)
  }
  return index
}

// Nearest point on the line, optionally restricted to the stretch with
// sMin <= s <= sMax (used to search forward along loop routes).
export function projectOnLine(line: ShapeLine, x: number, z: number, sMin = -Infinity, sMax = Infinity): Projection | null {
  const { xz, cum } = line
  let best: Projection | null = null
  for (let i = 0; i < cum.length - 1; i++) {
    const s0 = cum[i]
    const s1 = cum[i + 1]
    if (s1 < sMin || s0 > sMax) continue
    const ax = xz[2 * i]
    const az = xz[2 * i + 1]
    const dx = xz[2 * i + 2] - ax
    const dz = xz[2 * i + 3] - az
    const len = s1 - s0
    let t = 0
    if (len > 0) {
      t = ((x - ax) * dx + (z - az) * dz) / (len * len)
      t = Math.min(Math.min(1, (sMax - s0) / len), Math.max(Math.max(0, (sMin - s0) / len), t))
    }
    const px = ax + t * dx
    const pz = az + t * dz
    const d = Math.hypot(x - px, z - pz)
    if (!best || d < best.d) best = { s: s0 + t * len, d, x: px, z: pz }
  }
  return best
}

export interface LinePoint {
  x: number
  z: number
  hx: number // unit heading, direction of increasing s
  hz: number
}

export function pointAt(line: ShapeLine, s: number): LinePoint {
  const { xz, cum } = line
  const n = cum.length
  const ss = Math.min(line.length, Math.max(0, s))
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid] <= ss) lo = mid
    else hi = mid
  }
  const len = cum[hi] - cum[lo]
  const t = len > 0 ? (ss - cum[lo]) / len : 0
  const dx = xz[2 * hi] - xz[2 * lo]
  const dz = xz[2 * hi + 1] - xz[2 * lo + 1]
  const l = Math.hypot(dx, dz) || 1
  return { x: xz[2 * lo] + t * dx, z: xz[2 * lo + 1] + t * dz, hx: dx / l, hz: dz / l }
}
