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

export const CELL_M = 25
// Past the ring's edge, paving blends into bare ground over this distance.
export const EDGE_BLEND_M = 150

export interface PavingGrid {
  position: Float32Array
  color: Float32Array
  index: Uint32Array
}

export function buildPaving(city: CityData, y: number): PavingGrid {
  const { boundary } = city
  const ringMeters = city.header.ringMeters
  const reach = ringMeters + EDGE_BLEND_M
  let minX = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxZ = -Infinity
  for (let i = 0; i < boundary.coords.length; i += 2) {
    const x = boundary.coords[i] * COORD_QUANTUM
    const z = boundary.coords[i + 1] * COORD_QUANTUM
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  minX -= reach
  minZ -= reach
  const nx = Math.ceil((maxX + reach - minX) / CELL_M) + 1
  const nz = Math.ceil((maxZ + reach - minZ) / CELL_M) + 1

  const sidewalk = new Color(palette.sidewalk)
  const sky = new Color(palette.sky)
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
      // Distance past the boundary, measured out to `reach` (ringPosition caps at 1).
      const d = ringPosition(boundary, reach, x, z) * reach
      const ring = Math.min(1, d / ringMeters)
      const beyond = Math.min(1, Math.max(0, (d - ringMeters) / EDGE_BLEND_M))
      c.copy(sidewalk).lerp(sky, ringDim(ring)).lerp(ground, beyond * beyond * (3 - 2 * beyond))
      c.toArray(color, k)
    }

  const index = new Uint32Array((nx - 1) * (nz - 1) * 6)
  let t = 0
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i
      index.set([a, a + nx, a + 1, a + 1, a + nx, a + nx + 1], t)
      t += 6
    }
  return { position, color, index }
}
