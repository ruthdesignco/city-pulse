// San Francisco's land as a raster: DataSF's 41 Analysis Neighborhoods
// (they tile the city and county's land, Treasure Island, the Presidio and
// the parks included) filled on a CELL_M grid, so "is this in the city?"
// is a lookup, for every building, street and tree of the bake.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { toScene } from '../../src/geo/projection.ts'
import { type Pt, type Rect, openRing } from './geometry.ts'

const CELL_M = 25

interface Feature {
  properties: { nhood: string }
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] }
}

export const NEIGHBORHOODS_PATH = join(import.meta.dirname, '../data/analysis-neighborhoods.geojson')

// The outer rings of the named neighborhoods (all of them by default), in
// scene meters.
export function neighborhoodRings(names?: string[]): Pt[][] {
  const fc = JSON.parse(readFileSync(NEIGHBORHOODS_PATH, 'utf8')) as { features: Feature[] }
  const rings: Pt[][] = []
  for (const name of names ?? fc.features.map((f) => f.properties.nhood)) {
    const f = fc.features.find((x) => x.properties.nhood === name)
    if (!f) throw new Error(`neighborhoods: no feature named ${JSON.stringify(name)}`)
    const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as number[][][][]
    for (const poly of polys) {
      if (names && poly.length > 1) console.warn(`neighborhoods: ${name} has ${poly.length - 1} hole(s); ignoring holes`)
      rings.push(
        openRing(
          poly[0].map(([lng, lat]): Pt => {
            const s = toScene(lat, lng)
            return [s.x, s.z]
          }),
        ),
      )
    }
  }
  return rings
}

export class LandMask {
  readonly x0: number
  readonly z0: number
  readonly nx: number
  readonly nz: number
  private readonly cells: Uint8Array

  constructor(rings: Pt[][]) {
    let [minX, minZ, maxX, maxZ] = [Infinity, Infinity, -Infinity, -Infinity]
    for (const r of rings)
      for (const [x, z] of r) [minX, minZ, maxX, maxZ] = [Math.min(minX, x), Math.min(minZ, z), Math.max(maxX, x), Math.max(maxZ, z)]
    this.x0 = Math.floor(minX / CELL_M) * CELL_M
    this.z0 = Math.floor(minZ / CELL_M) * CELL_M
    this.nx = Math.ceil((maxX - this.x0) / CELL_M) + 1
    this.nz = Math.ceil((maxZ - this.z0) / CELL_M) + 1
    this.cells = new Uint8Array(this.nx * this.nz)
    // Each row's cell centers, filled between the rings' edges' crossings,
    // in pairs (the neighborhoods don't overlap).
    const xs: number[] = []
    for (let j = 0; j < this.nz; j++) {
      const z = this.z0 + (j + 0.5) * CELL_M
      xs.length = 0
      for (const r of rings)
        for (let k = 0; k < r.length; k++) {
          const [ax, az] = r[k]
          const [bx, bz] = r[(k + 1) % r.length]
          if (az <= z !== bz <= z) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax))
        }
      xs.sort((a, b) => a - b)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - this.x0) / CELL_M - 0.5))
        const i1 = Math.min(this.nx - 1, Math.floor((xs[k + 1] - this.x0) / CELL_M - 0.5))
        if (i1 >= i0) this.cells.fill(1, j * this.nx + i0, j * this.nx + i1 + 1)
      }
    }
  }

  has(x: number, z: number): boolean {
    const i = Math.floor((x - this.x0) / CELL_M)
    const j = Math.floor((z - this.z0) / CELL_M)
    return i >= 0 && j >= 0 && i < this.nx && j < this.nz && this.cells[j * this.nx + i] === 1
  }

  // The share of r's area that's land (by cell centers).
  fraction(r: Rect): number {
    let n = 0
    let land = 0
    for (let z = r.minZ + CELL_M / 2; z < r.maxZ; z += CELL_M)
      for (let x = r.minX + CELL_M / 2; x < r.maxX; x += CELL_M) {
        n++
        if (this.has(x, z)) land++
      }
    return n ? land / n : 0
  }
}
