import { describe, expect, it } from 'vitest'
import { FLAT, Terrain, decodeTerrain, encodeTerrain } from './terrain.ts'

// A 3 x 3 grid, 10 m cells from (100, 200): a 30 m hill in the middle.
const hill = new Terrain(
  { version: 2, x0: 100, z0: 200, cell: 10, nx: 3, nz: 3, quantum: 0.1, source: 'test', datum: 'NAVD88', bakedAt: '' },
  Int16Array.from([0, 0, 0, 0, 300, 0, 0, 0, 0]),
)

describe('Terrain', () => {
  it('reads grid points exactly and holds the edge value off the grid', () => {
    expect(hill.heightAt(110, 210)).toBeCloseTo(30, 9)
    expect(hill.heightAt(100, 200)).toBe(0)
    expect(hill.heightAt(-500, 210)).toBe(0)
    expect(FLAT.heightAt(1234, -5678)).toBe(0)
  })

  it('interpolates on the same triangles the ground mesh draws', () => {
    // Cell (0,0) splits along (100,200)-(110,210): on that diagonal, halfway up.
    expect(hill.heightAt(105, 205)).toBeCloseTo(15, 9)
    // Off the diagonal, on the triangle (0,0), (1,0), (1,1): plane through 0, 0, 30.
    expect(hill.heightAt(108, 202)).toBeCloseTo(6, 9)
    expect(hill.heightAt(102, 208)).toBeCloseTo(6, 9)
  })

  it('round-trips through terrain.bin bytes', async () => {
    const bytes = await encodeTerrain(hill)
    const back = await decodeTerrain(bytes.buffer as ArrayBuffer)
    expect(back.header).toEqual(hill.header)
    expect(Array.from(back.heights)).toEqual(Array.from(hill.heights))
  })
})
