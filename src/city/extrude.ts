// Turn baked footprints into one merged, flat-shaded mesh: one draw call for
// the whole city. Walls get their own vertices per edge so normals stay crisp.

import { ShapeUtils, Vector2 } from 'three'
import { type CityData, COORD_QUANTUM, HEIGHT_QUANTUM, RING_BAND_METERS } from './format.ts'

export interface CityMesh {
  positions: Float32Array
  normals: Float32Array
  ring: Float32Array // 0 inside the three neighborhoods, up to 1 at the ring's outer edge
  colorIndex: Float32Array // scripts/lib/buildingColor.ts: BuildingColorType*3 + buildingVariant, per vertex
  // For the facade windows (facade.ts), 4 per vertex: distance along this
  // wall from its start (m), the wall's length (m), the building's height
  // (m), and a per-building seed in [0, 1). Roof vertices have 0 for the
  // first two.
  facade: Float32Array
  index: Uint32Array
}

// A stable per-building seed in [0, 1) from its first footprint point, so a
// building keeps its window pattern across rebakes.
function seedOf(x: number, z: number): number {
  let h = Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(z | 0, 0x85ebca77)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

export function extrudeBuildings(b: CityData['buildings'], ringMeters = 600): CityMesh {
  let verts = 0
  let tris = 0
  for (const n of b.counts) {
    verts += n * 4 + n
    tris += n * 2 + (n - 2)
  }
  const positions = new Float32Array(verts * 3)
  const normals = new Float32Array(verts * 3)
  const ring = new Float32Array(verts)
  const colorIndex = new Float32Array(verts)
  const facade = new Float32Array(verts * 4)
  const index = new Uint32Array(tris * 3)

  let v = 0
  let t = 0
  let c = 0
  // Per building and per wall, set before its vertices are put.
  let height = 0
  let seed = 0
  let wallLen = 0
  const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, ci: number, wallU = 0) => {
    positions.set([x, y, z], v * 3)
    normals.set([nx, ny, nz], v * 3)
    ring[v] = r
    colorIndex[v] = ci
    facade.set([wallU, ny > 0.5 ? 0 : wallLen, height, seed], v * 4)
    return v++
  }

  for (let k = 0; k < b.counts.length; k++) {
    const n = b.counts[k]
    const h = b.heights[k] * HEIGHT_QUANTUM
    const r = Math.min(1, (b.ringBand[k] * RING_BAND_METERS) / ringMeters)
    const ci = b.colorIndex[k]
    const pts: [number, number][] = []
    seed = seedOf(b.coords[c], b.coords[c + 1])
    height = h
    for (let i = 0; i < n; i++, c += 2) pts.push([b.coords[c] * COORD_QUANTUM, b.coords[c + 1] * COORD_QUANTUM])

    // Walls. Rings have signedArea(x, z) > 0, so for edge direction (dx, dz)
    // the outward normal is (dz, -dx).
    for (let i = 0; i < n; i++) {
      const [x0, z0] = pts[i]
      const [x1, z1] = pts[(i + 1) % n]
      const len = Math.hypot(x1 - x0, z1 - z0) || 1
      const nx = (z1 - z0) / len
      const nz = -(x1 - x0) / len
      wallLen = len
      const a = put(x0, 0, z0, nx, 0, nz, r, ci, 0)
      const bb = put(x1, 0, z1, nx, 0, nz, r, ci, len)
      const cc = put(x1, h, z1, nx, 0, nz, r, ci, len)
      const d = put(x0, h, z0, nx, 0, nz, r, ci, 0)
      index.set([a, cc, bb, a, d, cc], t)
      t += 6
    }

    // Roof: earcut via three's ShapeUtils, then wind each triangle so its
    // face points up (+y).
    const base = v
    for (const [x, z] of pts) put(x, h, z, 0, 1, 0, r, ci)
    const faces = ShapeUtils.triangulateShape(
      pts.map(([x, z]) => new Vector2(x, z)),
      [],
    )
    for (const [i0, i1, i2] of faces) {
      const [ax, az] = pts[i0]
      const [bx, bz] = pts[i1]
      const [cx, cz] = pts[i2]
      // y-component of (b - a) x (c - a) in 3D with points (x, h, z)
      const up = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
      index.set(up > 0 ? [base + i0, base + i1, base + i2] : [base + i0, base + i2, base + i1], t)
      t += 3
    }
  }

  // Degenerate rings can make earcut return fewer triangles than n - 2.
  return { positions, normals, ring, colorIndex, facade, index: t === index.length ? index : index.slice(0, t) }
}
