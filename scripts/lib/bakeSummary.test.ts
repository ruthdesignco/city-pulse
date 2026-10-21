import { describe, expect, it } from 'vitest'
import type { CityData } from '../../src/city/format.ts'
import { seedHash } from '../../src/city/extrude.ts'
import { compareCities, describeCityChange } from './bakeSummary.ts'

// Buildings by their facade seed (city.bin buildings.seeds), from the
// first vertex in 0.1 m units as the bake computes it.
const city = (footprints: number[][], streets = 1): CityData =>
  ({
    buildings: {
      counts: Uint16Array.from(footprints.map((f) => f.length / 2)),
      heights: new Uint16Array(footprints.length),
      ringBand: new Uint8Array(footprints.length),
      colorIndex: new Uint8Array(footprints.length),
      seeds: Uint32Array.from(footprints, (f) => seedHash(f[0], f[1])),
      coords: Int16Array.from(footprints.flat()),
    },
    streets: { counts: new Uint16Array(streets).fill(2), classes: new Uint8Array(streets), coords: new Int16Array(4 * streets) },
  }) as unknown as CityData

const a = [0, 0, 100, 0, 100, 100]
const b = [500, 500, 600, 500, 600, 600]
const c = [900, 0, 990, 0, 990, 90]

describe('compareCities', () => {
  it('reports no new seeds for an identical bake', () => {
    expect(compareCities(city([a, b]), city([a, b]))).toEqual({ buildings: [2, 2], streets: [1, 1], newSeeds: 0 })
  })

  it('counts buildings that are new or whose first vertex moved', () => {
    const moved = [1, 0, 100, 0, 100, 100] // same building, redrawn: first vertex shifted 0.1 m
    expect(compareCities(city([a, b]), city([moved, b, c], 3))).toEqual({ buildings: [2, 3], streets: [1, 3], newSeeds: 2 })
  })

  it('describes the change in one line', () => {
    expect(describeCityChange({ buildings: [27469, 27463], streets: [4194, 4194], newSeeds: 0 })).toBe(
      'buildings 27469 -> 27463 (-6), streets 4194 -> 4194 (+0); 0 buildings with a new facade seed (their look may change)',
    )
  })
})
