import { describe, expect, it } from 'vitest'
import { COORD_QUANTUM } from './format.ts'
import { type TreesData, decodeTrees, encodeTrees } from './treeFormat.ts'

// A tile in the Outer Sunset: past the old single file's range.
const sample = (): TreesData => ({
  header: { version: 3, i: -9, j: 1, x0: -9000, z0: 1000, count: 3 },
  coords: Float32Array.from([-9000, 1000, -8500.3, 1700.6, -8001, 1999]),
  kind: Uint8Array.from([0, 1, 2]),
  tone: Uint8Array.from([0, 1, 3]),
  dbh: Uint8Array.from([8, 0, 100]),
  ring: Uint8Array.from([0, 128, 255]),
})

const toBuffer = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

describe('tree tile format', () => {
  it('round-trips every field, coordinates to the quantum', async () => {
    const data = sample()
    const back = await decodeTrees(toBuffer(await encodeTrees(data)))
    expect(back.header).toEqual(data.header)
    back.coords.forEach((v, k) => expect(Math.abs(v - data.coords[k])).toBeLessThanOrEqual(COORD_QUANTUM / 2 + 1e-3))
    for (const k of ['kind', 'tone', 'dbh', 'ring'] as const) expect(Array.from(back[k])).toEqual(Array.from(data[k]))
  })

  it('refuses arrays that disagree with the count, and foreign files', async () => {
    await expect(encodeTrees({ ...sample(), dbh: new Uint8Array(2) })).rejects.toThrow(/dbh/)
    const bytes = await encodeTrees(sample())
    bytes[0] = 0x58
    await expect(decodeTrees(toBuffer(bytes))).rejects.toThrow(/magic/)
  })

  it('refuses a tree beyond the Int16 range from its tile corner', async () => {
    const far = sample()
    far.coords[0] = 0
    await expect(encodeTrees(far)).rejects.toThrow(/outside the Int16 range/)
  })
})
