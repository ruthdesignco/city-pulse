// A soft shoreline where the Bay meets the unbaked land (Ground.tsx): a
// band of land tone straddling the waterline, transparent at both edges and
// partly opaque on the line itself, so land fades into water over a few
// tens of meters instead of meeting it at the water polygon's hard edge.
// Kept off the baked waterfront (paving.ts bareLand), where the piers and
// the Embarcadero make their own crisp edge.

import { Color } from 'three'
import { SHORELINE, bayOutline, inBay } from './bay.ts'
import { palette } from './palette.ts'

export const FEATHER_WIDTH_M = 160
// Opacity right on the waterline, where the band is strongest.
export const FEATHER_ALPHA = 0.75
const STEP_M = 25

export interface ShoreFeather {
  position: Float32Array
  color: Float32Array // RGBA, linear
  index: Uint32Array
}

// The shoreline resampled every STEP_M, with each point's unit normal
// pointing out over the water.
function shorePoints(): { x: number; z: number; nx: number; nz: number }[] {
  const outline = bayOutline()
  const line = outline.slice(0, SHORELINE.length)
  const pts: [number, number][] = []
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i]
    const [bx, bz] = line[i + 1]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STEP_M))
    for (let k = 0; k < n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n])
  }
  pts.push(line[line.length - 1])
  return pts.map(([x, z], i) => {
    const [px, pz] = pts[Math.max(0, i - 1)]
    const [qx, qz] = pts[Math.min(pts.length - 1, i + 1)]
    const len = Math.hypot(qx - px, qz - pz) || 1
    let nx = -(qz - pz) / len
    let nz = (qx - px) / len
    if (!inBay(x + nx * 20, z + nz * 20, outline)) {
      nx = -nx
      nz = -nz
    }
    return { x, z, nx, nz }
  })
}

// Three rows along the shore: land edge, waterline, water edge.
export function buildShoreFeather(bare: (x: number, z: number) => number, y: number): ShoreFeather {
  const pts = shorePoints()
  const land = new Color(palette.ground)
  const half = FEATHER_WIDTH_M / 2
  const position = new Float32Array(pts.length * 3 * 3)
  const color = new Float32Array(pts.length * 3 * 4)
  pts.forEach((p, i) => {
    const alpha = FEATHER_ALPHA * bare(p.x, p.z)
    for (let row = 0; row < 3; row++) {
      const offset = (row - 1) * half // -half on land, 0 on the line, +half over water
      const v = i * 3 + row
      position.set([p.x + p.nx * offset, y, p.z + p.nz * offset], v * 3)
      color.set([land.r, land.g, land.b, row === 1 ? alpha : 0], v * 4)
    }
  })
  const quads: number[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    // Skip stretches with nothing to show (the baked waterfront).
    if (color[(i * 3 + 1) * 4 + 3] === 0 && color[((i + 1) * 3 + 1) * 4 + 3] === 0) continue
    for (let row = 0; row < 2; row++) {
      const a = i * 3 + row
      const b = (i + 1) * 3 + row
      quads.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
  return { position, color, index: Uint32Array.from(quads) }
}
