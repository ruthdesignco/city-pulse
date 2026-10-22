import { describe, expect, it } from 'vitest'
import { COORD_QUANTUM, type CityTile, LAND_CELLS, decodeTile, encodeTile, joinParts, packCoords, toLines, unpackCoords } from './format.ts'

// A tile far from the origin (the Outer Sunset's): coordinates past the
// old single file's +-4.9 km range.
function sample(name = 'Salesforce Tower'): CityTile {
  const x0 = -9000
  const z0 = 1000
  return {
    header: { version: 2, i: -9, j: 1, x0, z0, pinnedMaterials: [{ building: 0, material: 3, name }] },
    // The west half land, the east half water.
    land: Uint8Array.from({ length: LAND_CELLS * LAND_CELLS }, (_, k) => (k % LAND_CELLS < LAND_CELLS / 2 ? 255 : 0)),
    buildings: {
      ...toLines([
        [
          [x0 + 10, z0 + 10],
          [x0 + 40.05, z0 + 10],
          [x0 + 40.05, z0 + 30],
          [x0 + 10, z0 + 30],
        ],
        [
          [x0 - 200, z0 + 1200],
          [x0 - 190, z0 + 1200],
          [x0 - 200, z0 + 1190],
        ],
      ]),
      heights: new Uint16Array([3260, 85]),
      ringBand: new Uint8Array([0, 200]),
      colorIndex: new Uint8Array([6, 4]),
      seeds: new Uint32Array([7, 4000000000]),
    },
    streets: {
      ...toLines([
        [
          [x0, z0],
          [x0 + 1000, z0 + 1000],
        ],
      ]),
      classes: new Uint8Array([1]),
    },
    cover: {
      ...toLines([
        [
          [x0, z0],
          [x0 + 10, z0],
          [x0, z0 + 10],
        ],
      ]),
      classes: new Uint8Array([2]),
    },
  }
}

describe('tile format', () => {
  it('round-trips every section and the header, to the coordinate quantum', async () => {
    const tile = sample()
    const back = await decodeTile((await encodeTile(tile)).buffer as ArrayBuffer)
    expect(back.header.pinnedMaterials).toEqual(tile.header.pinnedMaterials)
    expect([back.header.i, back.header.j, back.header.x0, back.header.z0]).toEqual([-9, 1, -9000, 1000])
    for (const part of ['buildings', 'streets', 'cover'] as const) {
      expect(back[part].counts).toEqual(tile[part].counts)
      back[part].coords.forEach((v, k) => expect(Math.abs(v - tile[part].coords[k])).toBeLessThanOrEqual(COORD_QUANTUM / 2 + 1e-3))
    }
    expect(back.buildings.heights).toEqual(tile.buildings.heights)
    expect(back.buildings.ringBand).toEqual(tile.buildings.ringBand)
    expect(back.buildings.colorIndex).toEqual(tile.buildings.colorIndex)
    expect(back.buildings.seeds).toEqual(tile.buildings.seeds)
    expect(back.streets.classes).toEqual(tile.streets.classes)
    expect(back.cover.classes).toEqual(tile.cover.classes)
    expect(back.land).toEqual(tile.land)
  })

  it('refuses a land mask of the wrong size', async () => {
    await expect(encodeTile({ ...sample(), land: new Uint8Array(10) })).rejects.toThrow(/land mask/)
  })

  it('stores a step of under ~9.6 m in one byte per axis', () => {
    const lines = toLines([
      [
        [0, 0],
        [9.45, -9.45],
      ],
    ])
    const packed = packCoords(lines, 0, 0)
    expect(packed.length).toBe(2 + 2) // the first point (0, 0), then one byte each
    expect(Array.from(unpackCoords(lines.counts, packed, 0, 0)).map((v) => Math.round(v * 100) / 100)).toEqual([0, 0, 9.45, -9.45])
  })

  it('refuses a point beyond the Int16 range from its tile corner', () => {
    expect(() => packCoords(toLines([[[5000, 0]]]), 0, 0)).toThrow(/outside the Int16 range/)
  })

  it('rejects another file', async () => {
    const bytes = await encodeTile(sample())
    bytes.set(new TextEncoder().encode('CPB1'), 0)
    await expect(decodeTile(bytes.buffer as ArrayBuffer)).rejects.toThrow(/bad magic/)
  })

  it('joins tiles end to end, renumbering pinned buildings', () => {
    const a = sample('A')
    const b = sample('B')
    const all = joinParts([a, b])
    expect(all.buildings.counts.length).toBe(4)
    expect(all.buildings.coords.length).toBe(a.buildings.coords.length * 2)
    expect(all.pinnedMaterials).toEqual([
      { building: 0, material: 3, name: 'A' },
      { building: 2, material: 3, name: 'B' },
    ])
  })
})
