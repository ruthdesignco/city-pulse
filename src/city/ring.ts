// The context ring: everything baked outside the three neighborhoods (up to
// ringMeters out). It fades gently toward the haze with distance, so the
// neighborhoods stay the subject without the ring looking washed out: no
// step at the boundary (a jump straight to 50% read as a pale band across
// the city), easing in to RING_DIM_MAX at the ring's edge. The Financial
// District's towers sit 0.6-1.3 km out, so this keeps the skyline crisp.
//
// Buildings carry their ring position from the bake (extrude.ts, `ring`);
// streets don't, so ringPosition() works it out from the boundary polygons:
// at load, from ringField's lattice (exactly, every street vertex and paving
// sample against every boundary edge took ~5 s once the city was tiled).

import type { CityData } from './format.ts'

// How far toward the haze a ring feature is mixed at the ring's outer edge.
export const RING_DIM_MAX = 0.3
// Trees and the woods' canopy take only this share of it: over their dark
// greens the full fade outweighed the green, and the woods read gray. The
// distance fog still hazes them.
export const GREENERY_RING_SHARE = 0.35

// `ring` is 0 inside the neighborhoods, rising to 1 at the ring's outer
// edge: 0 there, eased (smoothstep) up to RING_DIM_MAX. Buildings.tsx
// computes the same curve in GLSL.
export function ringDim(ring: number): number {
  const t = Math.min(1, Math.max(0, ring))
  return RING_DIM_MAX * t * t * (3 - 2 * t)
}

// 0 inside any boundary polygon, else distance to the nearest boundary edge
// over ringMeters, capped at 1.
export function ringPosition(boundary: CityData['boundary'], ringMeters: number, x: number, z: number): number {
  const { counts, coords } = boundary
  let inside = false
  let nearest = Infinity
  let c = 0
  for (const n of counts) {
    let insideThis = false
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = coords[c + 2 * i]
      const zi = coords[c + 2 * i + 1]
      const xj = coords[c + 2 * j]
      const zj = coords[c + 2 * j + 1]
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) insideThis = !insideThis
      nearest = Math.min(nearest, distToSegment(x, z, xj, zj, xi, zi))
    }
    if (insideThis) inside = true
    c += 2 * n
  }
  return inside ? 0 : Math.min(1, nearest / ringMeters)
}

// RING_FIELD_CELL_M lattice spacing: 25 m is 3% of an 800 m ring, which
// eases in over all of it.
export const RING_FIELD_CELL_M = 25

const fields = new WeakMap<CityData['boundary'], Map<string, (x: number, z: number) => number>>()

// ringPosition over an extent ([minX, minZ, maxX, maxZ]), worked out on a
// RING_FIELD_CELL_M lattice once (1 wherever the boundaries' box is more
// than ringMeters off) and read bilinearly; outside the extent, exactly.
export function ringField(boundary: CityData['boundary'], ringMeters: number, extent: [number, number, number, number]): (x: number, z: number) => number {
  const key = `${ringMeters}|${extent.join(',')}`
  let byKey = fields.get(boundary)
  if (!byKey) fields.set(boundary, (byKey = new Map()))
  const cached = byKey.get(key)
  if (cached) return cached
  const cell = RING_FIELD_CELL_M
  const x0 = Math.floor(extent[0] / cell) * cell
  const z0 = Math.floor(extent[1] / cell) * cell
  const nx = Math.ceil((extent[2] - x0) / cell) + 1
  const nz = Math.ceil((extent[3] - z0) / cell) + 1
  let [bx0, bz0, bx1, bz1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (let i = 0; i < boundary.coords.length; i += 2) {
    bx0 = Math.min(bx0, boundary.coords[i])
    bx1 = Math.max(bx1, boundary.coords[i])
    bz0 = Math.min(bz0, boundary.coords[i + 1])
    bz1 = Math.max(bz1, boundary.coords[i + 1])
  }
  const grid = new Float32Array(nx * nz)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell
      const z = z0 + j * cell
      const off = Math.hypot(Math.max(0, bx0 - x, x - bx1), Math.max(0, bz0 - z, z - bz1))
      grid[j * nx + i] = off >= ringMeters ? 1 : ringPosition(boundary, ringMeters, x, z)
    }
  const field = (x: number, z: number) => {
    const u = (x - x0) / cell
    const v = (z - z0) / cell
    if (u < 0 || v < 0 || u > nx - 1 || v > nz - 1) return ringPosition(boundary, ringMeters, x, z)
    const i = Math.min(nx - 2, Math.floor(u))
    const j = Math.min(nz - 2, Math.floor(v))
    const fu = u - i
    const fv = v - j
    const k = j * nx + i
    return (grid[k] * (1 - fu) + grid[k + 1] * fu) * (1 - fv) + (grid[k + nx] * (1 - fu) + grid[k + nx + 1] * fu) * fv
  }
  byKey.set(key, field)
  return field
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2))
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}
