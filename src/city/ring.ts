// The context ring: everything baked outside the three neighborhoods (up to
// ringMeters out). It fades toward the sky so the neighborhoods read as the
// subject: a clear step at the boundary, then deeper with distance.
//
// Buildings carry their ring position from the bake (extrude.ts, `ring`);
// streets don't, so ringPosition() works it out from the boundary polygons.

import { COORD_QUANTUM, type CityData } from './format.ts'

// How far toward the sky color a ring feature is mixed: RING_DIM_MIN just
// outside the boundary, up to RING_DIM_MIN + RING_DIM_RANGE at the ring's edge.
export const RING_DIM_MIN = 0.5
export const RING_DIM_RANGE = 0.35

// `ring` is 0 inside the neighborhoods, rising to 1 at the ring's outer edge.
export function ringDim(ring: number): number {
  return ring > 0 ? RING_DIM_MIN + RING_DIM_RANGE * Math.min(1, ring) : 0
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
      const xi = coords[c + 2 * i] * COORD_QUANTUM
      const zi = coords[c + 2 * i + 1] * COORD_QUANTUM
      const xj = coords[c + 2 * j] * COORD_QUANTUM
      const zj = coords[c + 2 * j + 1] * COORD_QUANTUM
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) insideThis = !insideThis
      nearest = Math.min(nearest, distToSegment(x, z, xj, zj, xi, zi))
    }
    if (insideThis) inside = true
    c += 2 * n
  }
  return inside ? 0 : Math.min(1, nearest / ringMeters)
}

function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const len2 = dx * dx + dz * dz
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2))
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz))
}
