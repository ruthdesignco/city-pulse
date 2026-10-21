// Paving: everything between the roads and the buildings is concrete, the
// same material as the sidewalks, so no bare ground shows through between a
// sidewalk's edge and a building's footprint. One flat grid over the bake
// area (neighborhoods + context ring), vertex-colored: sidewalk concrete,
// fading toward the sky in the ring exactly like the sidewalks and buildings
// there (ring.ts), then blending into the bare ground just past the ring's
// outer edge, where the city stops.

import { Color } from 'three'
import { COORD_QUANTUM, type CityData } from './format.ts'
import { palette } from './palette.ts'
import { ringDim, ringPosition } from './ring.ts'
import { distToOutline } from './waterfront.ts'

// The terrain's cell (scripts/bake-terrain.ts), on the same lattice from the
// scene origin and split along the same diagonal, so the paving lies exactly
// on the ground mesh (Ground.tsx).
export const CELL_M = 20
// Paving blends into bare ground over this distance either side of the ring's
// edge (inside it, at most half the ring).
export const EDGE_BLEND_M = 300

// Distance (m) past the three neighborhoods' boundary, measured out to
// ringMeters + EDGE_BLEND_M: within the waterfront extension, no further
// than the ring's edge; past the baked data's extent (the ring is cut off
// at its north edge), at least the ring's edge plus the distance past it.
export function bakeDistance(city: CityData): (x: number, z: number) => number {
  const { boundary } = city
  const ringMeters = city.header.ringMeters
  const waterfront = city.header.waterfront ?? []
  const extent = city.header.extent
  const reach = ringMeters + EDGE_BLEND_M
  return (x, z) => {
    let d = Math.min(ringPosition(boundary, reach, x, z) * reach, ringMeters + distToOutline(x, z, waterfront))
    if (extent) {
      const [minX, minZ, maxX, maxZ] = extent
      const outside = Math.hypot(Math.max(0, minX - x, x - maxX), Math.max(0, minZ - z, z - maxZ))
      if (outside > 0) d = Math.max(d, ringMeters + outside)
    }
    return d
  }
}

export interface PavingGrid {
  // The grid: first sample at (x0, z0), nx by nz, CELL_M apart.
  x0: number
  z0: number
  nx: number
  nz: number
  position: Float32Array
  color: Float32Array
  index: Uint32Array
}

export function buildPaving(city: CityData, y: number): PavingGrid {
  const { boundary } = city
  const ringMeters = city.header.ringMeters
  const waterfront = city.header.waterfront ?? []
  const reach = ringMeters + EDGE_BLEND_M
  // Bounds: the boundary padded by `reach`, the extension by the edge blend.
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  const include = (x: number, z: number, pad: number) => {
    minX = Math.min(minX, x - pad)
    maxX = Math.max(maxX, x + pad)
    minZ = Math.min(minZ, z - pad)
    maxZ = Math.max(maxZ, z + pad)
  }
  for (let i = 0; i < boundary.coords.length; i += 2)
    include(boundary.coords[i] * COORD_QUANTUM, boundary.coords[i + 1] * COORD_QUANTUM, reach)
  for (const [x, z] of waterfront) include(x, z, EDGE_BLEND_M)
  minX = Math.floor(minX / CELL_M) * CELL_M
  minZ = Math.floor(minZ / CELL_M) * CELL_M
  const nx = Math.ceil((maxX - minX) / CELL_M) + 1
  const nz = Math.ceil((maxZ - minZ) / CELL_M) + 1

  const distance = bakeDistance(city)
  const sidewalk = new Color(palette.sidewalk)
  const ground = new Color(palette.ground)
  const c = new Color()
  const position = new Float32Array(nx * nz * 3)
  const color = new Float32Array(nx * nz * 3)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = minX + i * CELL_M
      const z = minZ + j * CELL_M
      const k = (j * nx + i) * 3
      position.set([x, y, z], k)
      const d = distance(x, z)
      const ring = Math.min(1, d / ringMeters)
      // Into the land across the ring's edge, from EDGE_BLEND_M inside it (at
      // most half the ring) to EDGE_BLEND_M past it: the ring's outer paving
      // fades toward the haze, far paler than the land, and blending only
      // past the edge left a pale band between them.
      const start = ringMeters - Math.min(EDGE_BLEND_M, ringMeters / 2)
      const beyond = Math.min(1, Math.max(0, (d - start) / (ringMeters + EDGE_BLEND_M - start)))
      c.copy(sidewalk).lerp(ground, Math.max(ringDim(ring), beyond * beyond * (3 - 2 * beyond)))
      c.toArray(color, k)
    }

  const index = new Uint32Array((nx - 1) * (nz - 1) * 6)
  let t = 0
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i
      // Split from (i, j) to (i + 1, j + 1), as terrain.ts heightAt; facing up.
      index.set([a, a + nx + 1, a + 1, a, a + nx, a + nx + 1], t)
      t += 6
    }
  return { x0: minX, z0: minZ, nx, nz, position, color, index }
}
