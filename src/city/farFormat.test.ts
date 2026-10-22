import { describe, expect, it } from 'vitest'
import { type FarData, decodeFar, encodeFar } from './farFormat.ts'
import { COORD_QUANTUM, toLines } from './format.ts'

// Two tiles, one far west (past the old single file's range), with a
// block, a tower and some woods.
const sample: FarData = {
  header: { version: 1, tiles: [], landmarkY: { sutro: 253.28 }, bakedAt: '2026-10-22T00:00:00.000Z' },
  tiles: [
    {
      i: -9,
      j: 1,
      prisms: {
        ...toLines([
          [
            [-8990, 1010],
            [-8900, 1010],
            [-8900, 1080],
            [-8990, 1080],
          ],
        ]),
        base: Float32Array.of(12.3),
        height: Float32Array.of(9.6),
        colorIndex: Uint8Array.of(4),
        ring: Float32Array.of(1),
      },
      canopy: { cells: Uint16Array.of(0, 51, 2499), ground: Float32Array.of(30, 31.5, -0.5) },
    },
    {
      i: 1,
      j: -3,
      prisms: {
        ...toLines([
          [
            [1400, -2430],
            [1430, -2430],
            [1430, -2400],
          ],
          [
            [1500, -2500],
            [1520, -2500],
            [1520, -2480],
            [1500, -2480],
          ],
        ]),
        base: Float32Array.of(5, 6),
        height: Float32Array.of(326, 40),
        colorIndex: Uint8Array.of(6, 7),
        ring: Float32Array.of(0, 0.5),
      },
      canopy: { cells: new Uint16Array(0), ground: new Float32Array(0) },
    },
  ],
}

describe('far file', () => {
  it('round-trips every tile, to the quanta', async () => {
    const back = await decodeFar((await encodeFar(sample)).buffer as ArrayBuffer)
    expect(back.header.landmarkY).toEqual({ sutro: 253.28 })
    expect(back.tiles.map((t) => [t.i, t.j])).toEqual([
      [-9, 1],
      [1, -3],
    ])
    sample.tiles.forEach((t, k) => {
      const b = back.tiles[k]
      expect(b.prisms.counts).toEqual(t.prisms.counts)
      b.prisms.coords.forEach((v, c) => expect(Math.abs(v - t.prisms.coords[c])).toBeLessThanOrEqual(COORD_QUANTUM / 2 + 1e-3))
      b.prisms.base.forEach((v, c) => expect(v).toBeCloseTo(t.prisms.base[c], 1))
      b.prisms.height.forEach((v, c) => expect(v).toBeCloseTo(t.prisms.height[c], 1))
      expect(b.prisms.colorIndex).toEqual(t.prisms.colorIndex)
      b.prisms.ring.forEach((v, c) => expect(v).toBeCloseTo(t.prisms.ring[c], 2))
      expect(b.canopy.cells).toEqual(t.canopy.cells)
      b.canopy.ground.forEach((v, c) => expect(v).toBeCloseTo(t.canopy.ground[c], 1))
    })
  })

  it('rejects another file', async () => {
    const bytes = await encodeFar(sample)
    bytes.set(new TextEncoder().encode('CPK1'), 0)
    await expect(decodeFar(bytes.buffer as ArrayBuffer)).rejects.toThrow(/bad magic/)
  })
})
