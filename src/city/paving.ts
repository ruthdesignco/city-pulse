// Paving: everything between the roads and the buildings is concrete, the
// same material as the sidewalks, so no bare ground shows through between a
// sidewalk's edge and a building's footprint. One flat grid over the city's
// loaded tiles (header.extent), vertex-colored: sidewalk concrete, fading
// toward the land in the context ring exactly like the sidewalks and
// buildings there (ring.ts), then into the bare ground across the city's
// edge (cityEdge), where its tiles stop.

import { Color } from 'three'
import type { CityData } from './format.ts'
import { palette } from './palette.ts'
import { ringDim, ringField } from './ring.ts'

// The terrain's cell (scripts/bake-terrain.ts), on the same lattice from the
// scene origin and split along the same diagonal, so the paving lies exactly
// on the ground mesh (Ground.tsx).
export const CELL_M = 20
// Paving blends into bare ground over this distance across the city's edge,
// half inside it, half past it.
export const EDGE_BLEND_M = 300

// How far gone the city is at (x, z), 0..1 (linear: callers ease it): 0
// more than EDGE_BLEND_M / 2 inside its tiles' extent, 1 as far past it.
export function cityEdge(city: Pick<CityData, 'header'>): (x: number, z: number) => number {
  const [minX, minZ, maxX, maxZ] = city.header.extent
  return (x, z) => {
    // Signed distance to the extent's edge: negative inside.
    const dx = Math.max(minX - x, x - maxX)
    const dz = Math.max(minZ - z, z - maxZ)
    const d = dx > 0 || dz > 0 ? Math.hypot(Math.max(0, dx), Math.max(0, dz)) : Math.max(dx, dz)
    return Math.min(1, Math.max(0, (d + EDGE_BLEND_M / 2) / EDGE_BLEND_M))
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

export function buildPaving(city: Pick<CityData, 'header' | 'boundary'>, y: number): PavingGrid {
  const { boundary } = city
  const { ringMeters, extent } = city.header
  // The extent and the blend past it, on the CELL_M lattice.
  const minX = Math.floor((extent[0] - EDGE_BLEND_M / 2) / CELL_M) * CELL_M
  const minZ = Math.floor((extent[1] - EDGE_BLEND_M / 2) / CELL_M) * CELL_M
  const nx = Math.ceil((extent[2] + EDGE_BLEND_M / 2 - minX) / CELL_M) + 1
  const nz = Math.ceil((extent[3] + EDGE_BLEND_M / 2 - minZ) / CELL_M) + 1

  const edge = cityEdge(city)
  const ring = ringField(boundary, ringMeters, extent)
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
      const t = edge(x, z)
      c.copy(sidewalk).lerp(ground, Math.max(ringDim(ring(x, z)), t * t * (3 - 2 * t)))
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
