import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COORD_QUANTUM, decodeCity } from '../../src/city/format.ts'
import { palette } from '../../src/city/palette.ts'
import { decodeTrees } from '../../src/city/treeFormat.ts'
import { TREE_KINDS } from '../../src/city/treeSpecies.ts'

const toBuffer = (b: Uint8Array) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer

describe('the shipped trees.bin', () => {
  const read = (f: string) => toBuffer(readFileSync(join(import.meta.dirname, '../../public', f)))
  const trees = decodeTrees(read('trees.bin'))
  const city = decodeCity(read('city.bin'))

  it('has the city of trees, attributed, on the same origin as city.bin', () => {
    expect(trees.header.count).toBeGreaterThan(25_000)
    expect(trees.header.attribution).toMatch(/San Francisco Public Works.*DataSF/)
    expect(trees.header.origin).toEqual(city.header.origin)
  })

  it('keeps every tree inside the city data extent, with valid codes', () => {
    const [minX, minZ, maxX, maxZ] = city.header.extent!
    for (let i = 0; i < trees.header.count; i++) {
      const x = trees.coords[2 * i] * COORD_QUANTUM
      const z = trees.coords[2 * i + 1] * COORD_QUANTUM
      if (x < minX || x > maxX || z < minZ || z > maxZ) throw new Error(`tree ${i} at ${x}, ${z} is outside the extent`)
      if (trees.kind[i] >= TREE_KINDS || trees.tone[i] >= palette.treeGreens.length) throw new Error(`tree ${i} has a bad code`)
    }
  })

  it('records its provenance: the inventory hash and the exact city.bin it was placed against', () => {
    const cityBytes = readFileSync(join(import.meta.dirname, '../../public/city.bin'))
    expect(trees.header.inputSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(trees.header.city).toEqual({ bakedAt: city.header.bakedAt, sha256: createHash('sha256').update(cityBytes).digest('hex') })
  })

  it("city.bin records the OSM data's date and an input hash", () => {
    expect(Date.parse(city.header.osmTimestamp ?? '')).toBeGreaterThan(Date.parse('2026-01-01'))
    expect(city.header.osmElementsSha256).toMatch(/^[0-9a-f]{64}$/)
  })
})
