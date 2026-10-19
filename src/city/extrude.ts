// Turn baked footprints into one merged, flat-shaded mesh: one draw call for
// the whole city. Walls get their own vertices per edge so normals stay crisp.

import { ShapeUtils, Vector2 } from 'three'
import { type CityData, COORD_QUANTUM, HEIGHT_QUANTUM, RING_BAND_METERS } from './format.ts'

export interface CityMesh {
  positions: Float32Array
  normals: Float32Array
  ring: Float32Array // 0 inside the three neighborhoods, up to 1 at the ring's outer edge
  colorType: Float32Array // scripts/lib/buildingColor.ts's BuildingColorType, per vertex
  index: Uint32Array
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
  const colorType = new Float32Array(verts)
  const index = new Uint32Array(tris * 3)

  let v = 0
  let t = 0
  let c = 0
  const put = (x: number, y: number, z: number, nx: number, ny: number, nz: number, r: number, ct: number) => {
    positions.set([x, y, z], v * 3)
    normals.set([nx, ny, nz], v * 3)
    ring[v] = r
    colorType[v] = ct
    return v++
  }

  for (let k = 0; k < b.counts.length; k++) {
    const n = b.counts[k]
    const h = b.heights[k] * HEIGHT_QUANTUM
    const r = Math.min(1, (b.ringBand[k] * RING_BAND_METERS) / ringMeters)
    const ct = b.colorType[k]
    const pts: [number, number][] = []
    for (let i = 0; i < n; i++, c += 2) pts.push([b.coords[c] * COORD_QUANTUM, b.coords[c + 1] * COORD_QUANTUM])

    // Walls. Rings have signedArea(x, z) > 0, so for edge direction (dx, dz)
    // the outward normal is (dz, -dx).
    for (let i = 0; i < n; i++) {
      const [x0, z0] = pts[i]
      const [x1, z1] = pts[(i + 1) % n]
      const len = Math.hypot(x1 - x0, z1 - z0) || 1
      const nx = (z1 - z0) / len
      const nz = -(x1 - x0) / len
      const a = put(x0, 0, z0, nx, 0, nz, r, ct)
      const bb = put(x1, 0, z1, nx, 0, nz, r, ct)
      const cc = put(x1, h, z1, nx, 0, nz, r, ct)
      const d = put(x0, h, z0, nx, 0, nz, r, ct)
      index.set([a, cc, bb, a, d, cc], t)
      t += 6
    }

    // Roof: earcut via three's ShapeUtils, then wind each triangle so its
    // face points up (+y).
    const base = v
    for (const [x, z] of pts) put(x, h, z, 0, 1, 0, r, ct)
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
  return { positions, normals, ring, colorType, index: t === index.length ? index : index.slice(0, t) }
}
