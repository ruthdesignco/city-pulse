import { describe, expect, it } from 'vitest'
import { type TreesData, decodeTrees, encodeTrees } from './treeFormat.ts'

const sample = (): TreesData => ({
  header: { version: 1, count: 3, origin: { lat: 37.768, lng: -122.413 }, attribution: 'test', source: 'x', dataAsOf: '2026-10-16', bakedAt: 'now' },
  coords: Int16Array.from([1, -2, 300, 400, -32768, 32767]),
  kind: Uint8Array.from([0, 1, 2]),
  tone: Uint8Array.from([0, 1, 3]),
  dbh: Uint8Array.from([8, 0, 100]),
  ring: Uint8Array.from([0, 128, 255]),
})

const toBuffer = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

describe('trees.bin format', () => {
  it('round-trips every field', () => {
    const data = sample()
    const back = decodeTrees(toBuffer(encodeTrees(data)))
    expect(back.header).toEqual(data.header)
    for (const k of ['coords', 'kind', 'tone', 'dbh', 'ring'] as const) expect(Array.from(back[k])).toEqual(Array.from(data[k]))
  })

  it('refuses arrays that disagree with the count, and foreign files', () => {
    expect(() => encodeTrees({ ...sample(), dbh: new Uint8Array(2) })).toThrow(/dbh/)
    const bytes = encodeTrees(sample())
    bytes[0] = 0x58
    expect(() => decodeTrees(toBuffer(bytes))).toThrow(/magic/)
  })

  it('refuses a truncated file', () => {
    const bytes = encodeTrees(sample())
    expect(() => decodeTrees(toBuffer(bytes.subarray(0, bytes.length - 4)))).toThrow(/truncated/)
  })
})
