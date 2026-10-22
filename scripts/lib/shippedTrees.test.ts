import { describe, expect, it } from 'vitest'
import { COORD_QUANTUM, TILE_M } from '../../src/city/format.ts'
import { palette } from '../../src/city/palette.ts'
import { TREE_KINDS } from '../../src/city/treeSpecies.ts'
import { loadShippedCity } from './shippedCity.ts'

const shipped = await loadShippedCity()

describe('the shipped trees', () => {
  it('has the city of trees, its source recorded', () => {
    expect(shipped.trees.reduce((n, t) => n + t.header.count, 0)).toBeGreaterThan(120_000)
    expect(shipped.index.sources.trees).toMatch(/San Francisco Public Works.*DataSF/)
  })

  it('keeps every tree inside its own tile (to the coordinate quantum), with valid codes', () => {
    const q = COORD_QUANTUM
    for (const t of shipped.trees)
      for (let i = 0; i < t.header.count; i++) {
        const x = t.coords[2 * i] - t.header.x0
        const z = t.coords[2 * i + 1] - t.header.z0
        if (x < -q || x > TILE_M + q || z < -q || z > TILE_M + q) throw new Error(`tree ${i} at ${x}, ${z} is outside tile ${t.header.i},${t.header.j}`)
        if (t.kind[i] >= TREE_KINDS || t.tone[i] >= palette.treeGreens.length) throw new Error(`tree ${i} has a bad code`)
      }
  })

  it("the city records the OSM data's date and an input hash", () => {
    expect(Date.parse(shipped.index.osmTimestamp ?? '')).toBeGreaterThan(Date.parse('2026-01-01'))
    expect(shipped.index.osmElementsSha256).toMatch(/^[0-9a-f]{64}$/)
  })
})
