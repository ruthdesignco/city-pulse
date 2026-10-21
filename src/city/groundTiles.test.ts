import { describe, expect, it } from 'vitest'
import { LOD_STEPS, buildTile, coarseError, lodFor, tileRanges } from './groundTiles.ts'
import { Terrain } from './terrain.ts'

// A 33 x 33 grid, 5 m cells, with a bumpy hill.
const n = 33
const heights = new Int16Array(n * n)
for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = Math.round(10 * (40 * Math.exp(-((i - 16) ** 2 + (j - 16) ** 2) / 60) + 3 * Math.sin(i * 1.3) * Math.cos(j * 0.9)))
const hill = new Terrain({ version: 2, x0: 0, z0: 0, cell: 5, nx: n, nz: n, quantum: 0.1, source: 'test', datum: '', bakedAt: '' }, heights)

describe('ground tiles', () => {
  it('cover the grid', () => {
    const r = tileRanges(hill)
    expect(r).toEqual([{ i0: 0, j0: 0, i1: 32, j1: 32 }])
  })

  it('draw every sample on the true height at full detail', () => {
    const g = buildTile(hill, tileRanges(hill)[0], 1, 0)
    const pos = g.getAttribute('position')
    for (let k = 0; k < n * n; k++) expect(pos.getY(k)).toBeCloseTo(hill.heightAt(pos.getX(k), pos.getZ(k)), 4)
  })

  it('lower a coarse tile so it never rises above the true ground', () => {
    const r = tileRanges(hill)[0]
    for (const step of LOD_STEPS.slice(1)) {
      const g = buildTile(hill, r, step, 0)
      const pos = g.getAttribute('position')
      const w = Math.ceil(32 / step) + 1
      // Each coarse cell's surface, sampled at the true grid points under it.
      for (let k = 0; k < w * w; k++) expect(pos.getY(k)).toBeLessThanOrEqual(hill.heightAt(pos.getX(k), pos.getZ(k)) + 1e-6)
      expect(coarseError(hill, r, [0, 32], [0, 32])).toBeGreaterThan(0)
    }
  })

  it('pick more detail closer to the camera', () => {
    expect(lodFor(100)).toBe(0)
    expect(lodFor(1000)).toBe(1)
    expect(lodFor(2000)).toBe(2)
    expect(lodFor(9000)).toBe(3)
  })
})
