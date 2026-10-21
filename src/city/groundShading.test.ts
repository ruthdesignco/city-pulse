import { describe, expect, it } from 'vitest'
import { AO_MAX, normalsAo, occlusion } from './groundShading.ts'
import { Terrain } from './terrain.ts'

// A 61 x 61 grid, 5 m cells: flat at 20 m with a 10 m deep hollow and a
// 10 m high bump.
const n = 61
const h = new Int16Array(n * n).fill(200)
for (let j = 0; j < n; j++)
  for (let i = 0; i < n; i++) {
    h[j * n + i] -= Math.round(100 * Math.exp(-((i - 15) ** 2 + (j - 30) ** 2) / 8))
    h[j * n + i] += Math.round(100 * Math.exp(-((i - 45) ** 2 + (j - 30) ** 2) / 8))
  }
const t = new Terrain({ version: 2, x0: 0, z0: 0, cell: 5, nx: n, nz: n, quantum: 0.1, source: 'test', datum: '', bakedAt: '' }, h)

describe('ground occlusion', () => {
  it('darkens hollows, leaves open flat ground and tops alone', () => {
    const ao = occlusion(t)
    expect(ao[30 * n + 15]).toBeGreaterThan(0.2) // the hollow's floor
    expect(ao[30 * n + 15]).toBeLessThanOrEqual(AO_MAX)
    expect(ao[5 * n + 5]).toBeLessThan(0.01) // open flat ground
    expect(ao[30 * n + 45]).toBe(0) // the bump's top
  })

  it('packs up-facing normals and the occlusion into a texture', () => {
    const px = normalsAo(t)
    const k = (5 * n + 5) * 4
    expect(px[k + 1]).toBe(255) // flat: straight up
    expect(Math.abs(px[k] - 128)).toBeLessThanOrEqual(1)
    expect(px[(30 * n + 15) * 4 + 3]).toBeLessThan(205) // the hollow's occlusion in alpha
  })
})
