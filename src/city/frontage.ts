// Which street a building wall fronts on, if any, and whether that wall
// gets a ground-floor storefront (facade.ts). Worked out per wall while
// extruding (extrude.ts) from the baked street centerlines and roads.ts's
// widths per class.
//
// A wall fronts a street when it runs along it (nearly parallel), faces it,
// and stands no further from the centerline than the curb plus the
// sidewalk plus a small setback. Of several, the biggest street wins: a
// corner building fronts its main street on that side.

import { type CityData, StreetClass } from './format.ts'
import { ROAD_CLASS } from './roads.ts'

const CELL_M = 40
// How far past the back of the sidewalk a wall can stand and still front
// the street (OSM footprints and our class widths are both approximate).
export const SETBACK_M = 4
// Walls within ~18 degrees of the street's direction run along it.
const PARALLEL_COS = 0.95

const cellKey = (gx: number, gz: number) => gx * 100003 + gz

// Centerline to the furthest a fronting wall stands, for a street class.
export function frontageReach(cls: number): number {
  const r = ROAD_CLASS[cls]
  return r.asphaltM / 2 + r.sidewalkM + SETBACK_M
}

export class StreetFrontage {
  // Segments as [ax, az, bx, bz, class].
  private segs: [number, number, number, number, number][] = []
  private cells = new Map<number, number[]>()

  constructor(s: CityData['streets']) {
    let c = 0
    s.counts.forEach((n, k) => {
      const cls = s.classes[k]
      const reach = frontageReach(cls)
      for (let i = 0; i < n - 1; i++) {
        const ax = s.coords[c + 2 * i]
        const az = s.coords[c + 2 * i + 1]
        const bx = s.coords[c + 2 * i + 2]
        const bz = s.coords[c + 2 * i + 3]
        const id = this.segs.push([ax, az, bx, bz, cls]) - 1
        for (let gx = Math.floor((Math.min(ax, bx) - reach) / CELL_M); gx <= Math.floor((Math.max(ax, bx) + reach) / CELL_M); gx++)
          for (let gz = Math.floor((Math.min(az, bz) - reach) / CELL_M); gz <= Math.floor((Math.max(az, bz) + reach) / CELL_M); gz++) {
            const list = this.cells.get(cellKey(gx, gz))
            if (list) list.push(id)
            else this.cells.set(cellKey(gx, gz), [id])
          }
      }
      c += 2 * n
    })
  }

  // The StreetClass the wall from (x0, z0) to (x1, z1), facing outward along
  // (nx, nz), fronts on; -1 for none.
  classOf(x0: number, z0: number, x1: number, z1: number, nx: number, nz: number): number {
    const mx = (x0 + x1) / 2
    const mz = (z0 + z1) / 2
    const len = Math.hypot(x1 - x0, z1 - z0) || 1
    const wx = (x1 - x0) / len
    const wz = (z1 - z0) / len
    let best = -1
    for (const id of this.cells.get(cellKey(Math.floor(mx / CELL_M), Math.floor(mz / CELL_M))) ?? []) {
      const [ax, az, bx, bz, cls] = this.segs[id]
      // Classes run Major 0 < Minor 1 < Local 2: keep the biggest.
      if (best !== -1 && cls >= best) continue
      const dx = bx - ax
      const dz = bz - az
      const sl = Math.hypot(dx, dz)
      if (sl < 1e-6 || Math.abs((dx * wx + dz * wz) / sl) < PARALLEL_COS) continue
      const t = Math.max(0, Math.min(1, ((mx - ax) * dx + (mz - az) * dz) / (sl * sl)))
      const px = ax + t * dx - mx
      const pz = az + t * dz - mz
      // Within reach, and on the wall's outward side.
      if (Math.hypot(px, pz) > frontageReach(cls) || px * nx + pz * nz <= 0) continue
      best = cls
    }
    return best
  }
}

// Storefront odds by the street a wall fronts on. On a residential side
// street (Local) a residential building never gets one, and others only
// sometimes: corner stores and the odd workshop, not every block face.
export const STOREFRONT_SHARE: Record<number, number> = {
  [StreetClass.Major]: 0.9,
  [StreetClass.Minor]: 0.75,
  [StreetClass.Local]: 0.3,
}
// Too low for a 4.5 m shop floor with anything above it, or too short a
// wall for a shopfront bay.
export const STOREFRONT_MIN_HEIGHT_M = 6
export const STOREFRONT_MIN_WALL_M = 4

const fract = (x: number) => x - Math.floor(x)

// Per wall: does it get a storefront? `family` is the building's
// BuildingColorType (0 Neutral, 1 Residential, 2 Tower), `seed` its facade
// seed, so the choice is the building's: the same on every wall that fronts
// the same class of street.
export function hasStorefront(streetClass: number, family: number, seed: number, heightM: number, wallM: number): boolean {
  if (streetClass < 0 || heightM < STOREFRONT_MIN_HEIGHT_M || wallM < STOREFRONT_MIN_WALL_M) return false
  if (streetClass === StreetClass.Local && family === 1) return false
  return fract(seed * 61 + 0.53) < STOREFRONT_SHARE[streetClass]
}
