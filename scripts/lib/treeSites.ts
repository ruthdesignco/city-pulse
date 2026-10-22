// Where a street tree can't stand in our city: inside a baked building
// footprint, or on the asphalt Streets.tsx draws (each centerline's class's
// curb-to-curb width, roads.ts ROAD_CLASS). Both read the tiles, so trees are
// checked against exactly what's on screen. Spatial grids keep the ~40k
// lookups fast.

import type { CityData } from '../../src/city/format.ts'
import { ROAD_CLASS } from '../../src/city/roads.ts'

const CELL_M = 50

type Key = string
const key = (gx: number, gz: number): Key => `${gx},${gz}`
const cell = (v: number) => Math.floor(v / CELL_M)

class Grid {
  private cells = new Map<Key, number[]>()
  // Register `id` in every cell overlapping the box.
  add(id: number, minX: number, minZ: number, maxX: number, maxZ: number) {
    for (let gx = cell(minX); gx <= cell(maxX); gx++)
      for (let gz = cell(minZ); gz <= cell(maxZ); gz++) {
        const list = this.cells.get(key(gx, gz))
        if (list) list.push(id)
        else this.cells.set(key(gx, gz), [id])
      }
  }
  at(x: number, z: number): number[] {
    return this.cells.get(key(cell(x), cell(z))) ?? []
  }
}

export class FootprintIndex {
  private rings: Float64Array[] = []
  private grid = new Grid()

  constructor(b: CityData['buildings']) {
    let c = 0
    for (const n of b.counts) {
      const ring = new Float64Array(2 * n)
      let minX = Infinity
      let minZ = Infinity
      let maxX = -Infinity
      let maxZ = -Infinity
      for (let i = 0; i < 2 * n; i += 2) {
        const x = (ring[i] = b.coords[c + i])
        const z = (ring[i + 1] = b.coords[c + i + 1])
        minX = Math.min(minX, x)
        maxX = Math.max(maxX, x)
        minZ = Math.min(minZ, z)
        maxZ = Math.max(maxZ, z)
      }
      c += 2 * n
      this.grid.add(this.rings.push(ring) - 1, minX, minZ, maxX, maxZ)
    }
  }

  contains(x: number, z: number): boolean {
    for (const id of this.grid.at(x, z)) {
      const r = this.rings[id]
      const n = r.length / 2
      let inside = false
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = r[2 * i]
        const zi = r[2 * i + 1]
        const xj = r[2 * j]
        const zj = r[2 * j + 1]
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
      }
      if (inside) return true
    }
    return false
  }
}

export class RoadwayIndex {
  // Segments as [ax, az, bx, bz, half curb-to-curb width].
  private segs: [number, number, number, number, number][] = []
  private grid = new Grid()

  constructor(s: CityData['streets']) {
    let c = 0
    s.counts.forEach((n, k) => {
      const half = ROAD_CLASS[s.classes[k]].asphaltM / 2
      for (let i = 0; i < n - 1; i++) {
        const ax = s.coords[c + 2 * i]
        const az = s.coords[c + 2 * i + 1]
        const bx = s.coords[c + 2 * i + 2]
        const bz = s.coords[c + 2 * i + 3]
        const id = this.segs.push([ax, az, bx, bz, half]) - 1
        this.grid.add(id, Math.min(ax, bx) - half, Math.min(az, bz) - half, Math.max(ax, bx) + half, Math.max(az, bz) + half)
      }
      c += 2 * n
    })
  }

  // The street whose asphalt (x, z) is deepest inside: depth > 0 on the
  // roadway, <= 0 off it (minus the distance to that curb), -Infinity when
  // no street is near; (cx, cz) the nearest centerline point.
  private deepest(x: number, z: number): { depth: number; cx: number; cz: number; half: number } {
    let best = { depth: -Infinity, cx: x, cz: z, half: 0 }
    for (const id of this.grid.at(x, z)) {
      const [ax, az, bx, bz, half] = this.segs[id]
      const dx = bx - ax
      const dz = bz - az
      const len2 = dx * dx + dz * dz
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / len2))
      const cx = ax + t * dx
      const cz = az + t * dz
      const depth = half - Math.hypot(x - cx, z - cz)
      if (depth > best.depth) best = { depth, cx, cz, half }
    }
    return best
  }

  depth(x: number, z: number): number {
    return this.deepest(x, z).depth
  }

  onRoadway(x: number, z: number): boolean {
    return this.depth(x, z) > 0
  }

  // A curbside tree that lands up to `maxDepth` m onto our asphalt (our
  // widths are per class, not per street, and OSM centerlines aren't always
  // centered) moved straight out across the nearest curb to `inset` m inside
  // the sidewalk. Null if it's deeper, sits on the centerline, or the move
  // lands it on another street's asphalt.
  pushToCurb(x: number, z: number, maxDepth: number, inset: number): [number, number] | null {
    const { depth, cx, cz, half } = this.deepest(x, z)
    if (depth <= 0) return [x, z]
    const d = Math.hypot(x - cx, z - cz)
    if (depth > maxDepth || d < 1e-6) return null
    const nx = cx + ((x - cx) / d) * (half + inset)
    const nz = cz + ((z - cz) / d) * (half + inset)
    return this.onRoadway(nx, nz) ? null : [nx, nz]
  }
}

// How far a curbside tree may be moved onto our sidewalk (pushToCurb), and
// where it ends up: just inside the curb, where street trees stand.
export const CURB_PUSH_MAX_M = 2
export const CURB_INSET_M = 0.6
