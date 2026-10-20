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

export const CELL_M = 25
// Past the ring's edge, paving blends into bare ground over this distance.
export const EDGE_BLEND_M = 300

export interface PavingGrid {
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
  const nx = Math.ceil((maxX - minX) / CELL_M) + 1
  const nz = Math.ceil((maxZ - minZ) / CELL_M) + 1

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
      // Distance past the boundary, measured out to `reach` (ringPosition caps
      // at 1); inside the waterfront extension, no further than the ring's edge.
      const d = Math.min(ringPosition(boundary, reach, x, z) * reach, ringMeters + distToOutline(x, z, waterfront))
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
