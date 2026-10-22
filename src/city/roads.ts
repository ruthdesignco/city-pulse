// Road surfaces from the baked street centerlines (the tiles): each street is
// a flat ribbon of asphalt with a lighter sidewalk strip along both edges,
// and the wider classes get dashed lane lines. Widths are typical San
// Francisco curb-to-curb and sidewalk widths per class, not per street (the
// bake keeps only a class).
//
// Three layers, each one merged geometry: sidewalks (full right-of-way
// width), asphalt over them (curb-to-curb), markings over that. Drawn in that
// order with rising height and polygon offset, so at an intersection the
// crossing street's asphalt covers the sidewalk -- corners open up the way
// real ones do.

import { StreetClass } from './format.ts'

export type Pt = [number, number]

export interface RoadClass {
  asphaltM: number // curb to curb
  sidewalkM: number // each side
  lanes: number // lane count; lane lines between them (none for 1)
}

export const ROAD_CLASS: Record<number, RoadClass> = {
  [StreetClass.Major]: { asphaltM: 18, sidewalkM: 4, lanes: 4 },
  [StreetClass.Minor]: { asphaltM: 13, sidewalkM: 3.5, lanes: 2 },
  [StreetClass.Local]: { asphaltM: 9, sidewalkM: 2.5, lanes: 1 },
}

// US standard skip line: 10 ft dash, 30 ft gap; 4 in wide.
export const DASH_M = 3
export const DASH_GAP_M = 9
export const LINE_WIDTH_M = 0.12
// Past this turn the miter is clamped, so a hairpin doesn't spike out.
const MAX_MITER = 3

export interface Mesh {
  position: number[] // x, y, z
  index: number[]
  // Per vertex, ribbons only (for streetlight pools, Streets.tsx): distance
  // along the street from its start, and signed offset from its centerline
  // (+ left), in meters.
  along: number[]
  offset: number[]
}

export const emptyMesh = (): Mesh => ({ position: [], index: [], along: [], offset: [] })

// Direction of (dx, dz), or of the fallback when it's degenerate.
function unit(dx: number, dz: number, fx: number, fz: number): Pt {
  let l = Math.hypot(dx, dz)
  if (l < 1e-9) {
    dx = fx
    dz = fz
    l = Math.hypot(dx, dz)
  }
  return l < 1e-9 ? [1, 0] : [dx / l, dz / l]
}

// A ribbon `halfWidth` either side of `line`, mitered at the joints, at height y.
export function ribbon(out: Mesh, line: Pt[], halfWidth: number, y: number) {
  const n = line.length
  if (n < 2) return
  const base = out.position.length / 3
  let along = 0
  for (let i = 0; i < n; i++) {
    if (i > 0) along += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])
    out.along.push(along, along)
    out.offset.push(halfWidth, -halfWidth)
    const [px, pz] = line[Math.max(0, i - 1)]
    const [cx, cz] = line[i]
    const [nx, nz] = line[Math.min(n - 1, i + 1)]
    // Unit directions of the segments into and out of this point.
    const [bx, bz] = unit(nx - cx, nz - cz, cx - px, cz - pz)
    const [ax, az] = unit(cx - px, cz - pz, bx, bz)
    let [tx, tz] = unit(ax + bx, az + bz, bx, bz)
    if (Math.hypot(ax + bx, az + bz) < 1e-6) [tx, tz] = [bx, bz]
    // Left normal of the averaged tangent, lengthened to keep the ribbon's
    // width across the corner.
    const cos = tx * bx + tz * bz
    const miter = Math.min(MAX_MITER, 1 / Math.max(cos, 1 / MAX_MITER))
    const ox = -tz * halfWidth * miter
    const oz = tx * halfWidth * miter
    out.position.push(cx + ox, y, cz + oz, cx - ox, y, cz - oz)
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + 2 * i
    out.index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
  }
}

// Dashed lines along `line`, each `offset` meters to its left (negative:
// right), the dash pattern restarting per street.
export function dashes(out: Mesh, line: Pt[], offsets: number[], y: number) {
  let s0 = 0 // distance along the line at the start of this segment
  let next = DASH_GAP_M / 2 // where the next dash starts
  for (let i = 0; i < line.length - 1; i++) {
    const [x0, z0] = line[i]
    const [x1, z1] = line[i + 1]
    const len = Math.hypot(x1 - x0, z1 - z0)
    if (len < 1e-6) continue
    const ux = (x1 - x0) / len
    const uz = (z1 - z0) / len
    const hx = -uz * (LINE_WIDTH_M / 2)
    const hz = ux * (LINE_WIDTH_M / 2)
    while (next < s0 + len) {
      const a = next - s0
      const b = Math.min(len, a + DASH_M)
      for (const off of offsets) {
        const cx = -uz * off
        const cz = ux * off
        const ax = x0 + ux * a + cx
        const az = z0 + uz * a + cz
        const bx = x0 + ux * b + cx
        const bz = z0 + uz * b + cz
        const base = out.position.length / 3
        out.position.push(ax + hx, y, az + hz, ax - hx, y, az - hz, bx + hx, y, bz + hz, bx - hx, y, bz - hz)
        out.index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
      }
      next += DASH_M + DASH_GAP_M
    }
    s0 += len
  }
}

// Lateral offsets of the lines between `lanes` equal lanes across `asphaltM`.
export function laneLineOffsets(asphaltM: number, lanes: number): number[] {
  const out: number[] = []
  for (let i = 1; i < lanes; i++) out.push(-asphaltM / 2 + (asphaltM * i) / lanes)
  return out
}
