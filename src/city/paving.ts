// Paving: everything between the roads and the buildings is concrete, the
// same material as the sidewalks, so no bare ground shows through between a
// sidewalk's edge and a building's footprint. Per tile, a CELL_M grid of
// colors over it edge to edge (a texture: Ground.tsx), sidewalk concrete
// fading toward the land in the context ring exactly like the sidewalks and
// buildings there (ring.ts), and gone where the city's land ends (the
// tiles' land masks: format.ts), so the ground past the county line, and
// on Alcatraz, is the land beyond's (landShading.ts).

import { Color } from 'three'
import { TILE_M } from './format.ts'
import { palette } from './palette.ts'
import { ringDim } from './ring.ts'

export const CELL_M = 20
export const PAVING_SAMPLES = TILE_M / CELL_M + 1 // per side, edges shared with the neighbors
// The paving's edge: how far each way of the land's edge it blends out.
export const EDGE_BLEND_M = 40

// A tile's paving from its corner (x0, z0): PAVING_SAMPLES square, RGBA, the
// color in sRGB (the shader decodes it) and in alpha how paved it is.
// `landAt`: how much of the ground at (x, z) is the city's land (0..1);
// `ringAt`: ring.ts ringPosition.
export function pavingPixels(x0: number, z0: number, landAt: (x: number, z: number) => number, ringAt: (x: number, z: number) => number): Uint8Array {
  const n = PAVING_SAMPLES
  const sidewalk = new Color(palette.sidewalk)
  const ground = new Color(palette.ground)
  const c = new Color()
  const out = new Uint8Array(n * n * 4)
  const d = EDGE_BLEND_M / 2
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = x0 + i * CELL_M
      const z = z0 + j * CELL_M
      c.copy(sidewalk).lerp(ground, ringDim(ringAt(x, z))).convertLinearToSRGB()
      // The land's share around the sample, eased: a soft edge where it ends.
      const land = (landAt(x, z) * 2 + landAt(x - d, z) + landAt(x + d, z) + landAt(x, z - d) + landAt(x, z + d)) / 6
      const t = Math.min(1, Math.max(0, (land - 0.2) / 0.6))
      out.set([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), Math.round(255 * t * t * (3 - 2 * t))], (j * n + i) * 4)
    }
  return out
}
