import { describe, expect, it } from 'vitest'
import { type CityTile, CoverClass, HEIGHT_QUANTUM, LAND_CELLS, toLines } from '../format.ts'
import { FAR_CANOPY_CELLS, FAR_CANOPY_CELL_M, type FarTile } from '../farFormat.ts'
import { PAVING_SAMPLES } from '../paving.ts'
import { Terrain } from '../terrain.ts'
import { type TreesData } from '../treeFormat.ts'
import { ROOF_FIELDS, type TileContext, buildBase, buildCanopy, buildFar, buildMid, buildNear, landAt } from './tileBuild.ts'

// Two tiles side by side, (0, 0) and (1, 0), both the city's land; flat
// ground at 10 m. Tile (0, 0) has a 30 x 20 m building, 20 m tall, by a
// street, and a wood in its southeast corner.
const square = (x: number, z: number, w: number, d: number): [number, number][] => [
  [x, z],
  [x + w, z],
  [x + w, z + d],
  [x, z + d],
]
const tile = (i: number, j: number, withBuilding: boolean): CityTile => ({
  header: { version: 2, i, j, x0: i * 1000, z0: j * 1000, pinnedMaterials: [] },
  land: new Uint8Array(LAND_CELLS * LAND_CELLS).fill(255),
  buildings: withBuilding
    ? { ...toLines([square(400, 400, 30, 20)]), heights: Uint16Array.of(200), ringBand: Uint8Array.of(0), colorIndex: Uint8Array.of(3), seeds: Uint32Array.of(12345) }
    : { ...toLines([]), heights: new Uint16Array(0), ringBand: new Uint8Array(0), colorIndex: new Uint8Array(0), seeds: new Uint32Array(0) },
  streets: withBuilding
    ? {
        ...toLines([
          [
            [300, 390],
            [600, 390],
          ],
        ]),
        classes: Uint8Array.of(1),
      }
    : { ...toLines([]), classes: new Uint8Array(0) },
  cover: withBuilding ? { ...toLines([square(800, 800, 200, 200)]), classes: Uint8Array.of(CoverClass.Wood) } : { ...toLines([]), classes: new Uint8Array(0) },
})
const ground = (i: number, j: number) =>
  new Terrain({ version: 2, x0: i * 1000, z0: j * 1000, cell: 5, nx: 201, nz: 201, quantum: 0.1, source: 'test', datum: '', bakedAt: '' }, new Int16Array(201 * 201).fill(100))
const trees: TreesData = {
  header: { version: 3, i: 0, j: 0, x0: 0, z0: 0, count: 2 },
  coords: Float32Array.of(350, 395, 360, 395),
  kind: Uint8Array.of(0, 1),
  tone: Uint8Array.of(0, 1),
  dbh: Uint8Array.of(10, 12),
  ring: Uint8Array.of(0, 0),
}
const ctx: TileContext = {
  ringMeters: 800,
  boundary: toLines([square(-100, -100, 1300, 1300)]),
  city: new Map([
    ['0,0', tile(0, 0, true)],
    ['1,0', tile(1, 0, false)],
  ]),
  terrain: new Map([
    ['0,0', ground(0, 0)],
    ['1,0', ground(1, 0)],
  ]),
  trees: new Map([['0,0', trees]]),
}

describe('tile builds', () => {
  it("reads the land masks across tiles' edges, and none where no tile is", () => {
    expect(landAt(ctx, 500, 500)).toBe(1)
    expect(landAt(ctx, 1000, 500)).toBe(1) // on the edge between the two
    expect(landAt(ctx, 500, -500)).toBe(0)
    expect(landAt(ctx, 500, -1)).toBeCloseTo(0.5, 1) // half a cell from the land's edge
  })

  it('builds the base: the maps over the terrain grid, the ground mesh and the streets on the ground', () => {
    const b = buildBase(ctx, 0, 0, 4)
    expect(b.normals.length).toBe(201 * 201 * 4)
    // Flat ground: straight up.
    expect(b.normals[(100 * 201 + 100) * 4 + 1]).toBe(255)
    expect(b.paving.length).toBe(PAVING_SAMPLES * PAVING_SAMPLES * 4)
    expect(b.ground.step).toBe(4)
    expect(b.ground.position.length).toBeGreaterThan(0)
    // Streets 10 m up with the ground, plus their few centimeters.
    const ys = Array.from({ length: b.streets.asphalt.position.length / 3 }, (_, k) => b.streets.asphalt.position[3 * k + 1])
    expect(Math.min(...ys)).toBeGreaterThan(10)
    expect(Math.max(...ys)).toBeLessThan(10.5)
  })

  it('builds near: the building in full, its contact grid over the tile, rooftop items, trees', () => {
    const n = buildNear(ctx, 0, 0)
    expect(n.buildings.index.length).toBeGreaterThan(0)
    expect(n.contact.grid.x0).toBeLessThan(0)
    expect(n.contact.grid.x0 + n.contact.grid.nx * n.contact.grid.cell).toBeGreaterThan(1000)
    expect(n.rooftops.length % ROOF_FIELDS).toBe(0)
    expect(n.trees.reduce((k, g) => k + g.rings.length, 0)).toBe(2)
  })

  it('builds mid: the building as a prism on the ground, its height above it', () => {
    const m = buildMid(ctx, 0, 0)
    expect(m.positions.length / 3).toBe(2 * 4)
    const ys = Array.from({ length: 8 }, (_, k) => m.positions[3 * k + 1])
    expect(Math.min(...ys)).toBeCloseTo(10)
    expect(Math.max(...ys)).toBeCloseTo(10 + 200 * HEIGHT_QUANTUM)
    // Walls and a two-triangle roof.
    expect(m.index.length).toBe(3 * (2 * 4 + 2))
  })

  it("builds the woods' canopy over its cells, walled where they end", () => {
    const far: FarTile = {
      i: 0,
      j: 0,
      prisms: { ...toLines([]), base: new Float32Array(0), height: new Float32Array(0), colorIndex: new Uint8Array(0), ring: new Float32Array(0) },
      canopy: { cells: Uint16Array.of(0, 1, FAR_CANOPY_CELLS), ground: Float32Array.of(10, 10, 10) },
    }
    const c = buildCanopy(far, () => 1)
    const tops = Array.from({ length: c.position.length / 3 }, (_, k) => c.position[3 * k + 1]).filter((y) => y > 10)
    expect(Math.min(...tops)).toBeGreaterThan(10 + 12 * 0.74)
    expect(Math.max(...tops)).toBeLessThan(10 + 12 * 1.26)
    // Three cells: three tops of two triangles, and walls on their open sides
    // (4 + 4 + 4 sides less the two shared, each counted from both sides).
    expect(c.index.length / 3).toBe(3 * 2 + 2 * (3 * 4 - 2 * 2))
    expect(Math.max(...Array.from({ length: c.position.length / 3 }, (_, k) => c.position[3 * k]))).toBeLessThanOrEqual(2 * FAR_CANOPY_CELL_M)
    expect(buildFar(far, ctx).canopy).not.toBeNull()
  })
})
