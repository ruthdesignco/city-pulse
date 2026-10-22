import { describe, expect, it } from 'vitest'
import { AO_MAX, CONTACT_CELL_M, CONTACT_MAX, CONTACT_REACH_M, contact, normalsAo, occlusion } from './groundShading.ts'
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

describe('contact shading', () => {
  // A 60 x 20 strip of 2 m texels: a lone wall (a block filling i < 10),
  // and further on an alley 2 texels (4 m) wide between two blocks.
  const w = 60
  const rows = 20
  const cover = new Float32Array(w * rows)
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < w; i++) if (i < 10 || (i >= 40 && i < 45) || i >= 47) cover[j * w + i] = 1
  const at = (i: number) => contact(cover, w, rows)[10 * w + i] / 255

  it('darkens the ground at the foot of a wall, fading out by its reach', () => {
    expect(at(10)).toBeGreaterThan(0.5 * CONTACT_MAX)
    expect(at(10)).toBeLessThanOrEqual(CONTACT_MAX)
    expect(at(10 + Math.ceil(CONTACT_REACH_M / CONTACT_CELL_M))).toBe(0)
    expect(at(12)).toBeLessThan(at(10))
  })

  it('darkens an alley more than the foot of a lone wall', () => {
    expect(at(45)).toBeGreaterThan(at(10))
  })
})
