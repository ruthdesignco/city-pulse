// Route shapes as measured polylines: project a point onto a shape to get its
// distance along it, and go back from a distance to a point.
//
// For a polyline P0..Pn with cumulative lengths L0..Ln and a point q, each
// segment gives t = clamp(((q - Pi) . (Pi+1 - Pi)) / |Pi+1 - Pi|^2, 0, 1);
// the nearest segment's foot Pi + t (Pi+1 - Pi) gives s = Li + t |Pi+1 - Pi|
// (distance along) and d = |q - foot| (distance off the line).
//
// Lines are street centerlines where the bake snapped them (snapRoute.ts),
// each vertex tagged with its street's class; lanePoint draws a vehicle off
// to the right of the centerline, in its lane (lanes.ts).

import type { RoutesFile } from './routes-format.ts'

export interface ShapeLine {
  key: string // `${shapeId}#${piece}`
  routeId: string
  direction: 0 | 1 | null
  xz: Float64Array // x0, z0, x1, z1, ... in scene meters
  cum: Float64Array // distance along the line at each vertex
  length: number
  cls: Uint8Array // street class at each vertex (routes-format.ts lanes; 3 off street)
  right: Float64Array // unit right-hand normal at each vertex, mitered: x0, z0, ...
}

const OFF_STREET = 3
// Mitered normals are lengthened to keep a lane's width around a corner, up
// to this (a hairpin would otherwise spike out).
const MAX_MITER = 2

export type ShapeIndex = Map<string, ShapeLine[]> // by GTFS route_id

export interface Projection {
  s: number
  d: number
  x: number
  z: number
}

export function makeLine(key: string, routeId: string, direction: 0 | 1 | null, coords: ArrayLike<number>, lanes?: ArrayLike<number>): ShapeLine {
  const xz = Float64Array.from(coords)
  const n = xz.length / 2
  const cum = new Float64Array(n)
  for (let i = 1; i < n; i++)
    cum[i] = cum[i - 1] + Math.hypot(xz[2 * i] - xz[2 * i - 2], xz[2 * i + 1] - xz[2 * i - 1])
  const cls = new Uint8Array(n).fill(OFF_STREET)
  if (lanes && lanes.length === n) cls.set(lanes)
  // Right normal of each segment, (-hz, hx); at a vertex the two averaged.
  const seg = new Float64Array(2 * Math.max(0, n - 1))
  for (let i = 0; i < n - 1; i++) {
    const dx = xz[2 * i + 2] - xz[2 * i]
    const dz = xz[2 * i + 3] - xz[2 * i + 1]
    const l = Math.hypot(dx, dz) || 1
    seg[2 * i] = -dz / l
    seg[2 * i + 1] = dx / l
  }
  const right = new Float64Array(2 * n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1)
    const b = Math.min(n - 2, i)
    if (b < 0) break
    let rx = seg[2 * a] + seg[2 * b]
    let rz = seg[2 * a + 1] + seg[2 * b + 1]
    const l = Math.hypot(rx, rz)
    if (l < 1e-9) {
      rx = seg[2 * b]
      rz = seg[2 * b + 1]
    } else {
      rx /= l
      rz /= l
    }
    const miter = Math.min(MAX_MITER, 1 / Math.max(rx * seg[2 * b] + rz * seg[2 * b + 1], 1 / MAX_MITER))
    right[2 * i] = rx * miter
    right[2 * i + 1] = rz * miter
  }
  return { key, routeId, direction, xz, cum, length: cum[n - 1] ?? 0, cls, right }
}

export function buildShapeIndex(file: RoutesFile): ShapeIndex {
  const index: ShapeIndex = new Map()
  for (const route of file.routes) {
    const lines: ShapeLine[] = []
    for (const shape of route.shapes)
      shape.pieces.forEach((piece, k) => {
        const line = makeLine(`${shape.id}#${k}`, route.id, shape.direction, piece.map((v) => v * file.coordQuantum), shape.lanes?.[k])
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

// The segment holding distance s, and how far along it (0..1).
function locate(line: ShapeLine, s: number): { lo: number; hi: number; t: number } {
  const { cum } = line
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
  return { lo, hi, t: len > 0 ? (ss - cum[lo]) / len : 0 }
}

export function pointAt(line: ShapeLine, s: number): LinePoint {
  const { xz } = line
  const { lo, hi, t } = locate(line, s)
  const dx = xz[2 * hi] - xz[2 * lo]
  const dz = xz[2 * hi + 1] - xz[2 * lo + 1]
  const l = Math.hypot(dx, dz) || 1
  return { x: xz[2 * lo] + t * dx, z: xz[2 * lo + 1] + t * dz, hx: dx / l, hz: dz / l }
}

// In a Muni Metro tunnel at s: both ends of its segment tagged as subway
// (routes-format.ts lanes; the bake puts a vertex at every portal).
const SUBWAY = 4
export function isUnderground(line: ShapeLine, s: number): boolean {
  const { lo, hi } = locate(line, s)
  return line.cls[lo] === SUBWAY && line.cls[hi] === SUBWAY
}

// pointAt, moved `offsetOf(class)` meters to the right of the line: each
// vertex's offset along its mitered normal, blended along the segment, so a
// vehicle keeps to its lane around a rounded corner and eases across where
// the street's class (and so its lanes) changes.
export function lanePoint(line: ShapeLine, s: number, offsetOf: (cls: number) => number): LinePoint {
  const p = pointAt(line, s)
  const { lo, hi, t } = locate(line, s)
  const { right, cls } = line
  const a = offsetOf(cls[lo])
  const b = offsetOf(cls[hi])
  p.x += (1 - t) * right[2 * lo] * a + t * right[2 * hi] * b
  p.z += (1 - t) * right[2 * lo + 1] * a + t * right[2 * hi + 1] * b
  return p
}
