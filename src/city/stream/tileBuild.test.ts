import { describe, expect, it } from 'vitest'
import { HEIGHT_QUANTUM, toLines } from '../format.ts'
import { FAR_CANOPY_CELLS, FAR_CANOPY_CELL_M, type FarTile } from '../farFormat.ts'
import { PAVING_SAMPLES } from '../paving.ts'
import { ROOF_FIELDS, buildBase, buildCanopy, buildFar, buildMid, buildNear, landAt } from './tileBuild.ts'
import { ctx } from './tileFixtures.ts'

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
