// What a tile draws, built from its files and its neighbors' (format.ts,
// terrain.ts, treeFormat.ts, farFormat.ts) in the tile worker
// (tileWorker.ts), as plain arrays the page turns into meshes and
// textures (CityTiles.tsx). Pure functions over a TileContext, so tests
// run them without a worker.
//
//   base   the ground's maps (normals and occlusion, cover, paving), its
//          mesh at one level of detail, and the streets: whatever the
//          tile's level, once
//   lod    the ground's mesh at another level of detail
//   near   the buildings in full, their contact shading, rooftop items, trees
//   mid    the buildings as plain prisms (extrude.ts extrudePrisms)
//   far    from the far file: the blocks as prisms and the woods' canopy
//
// Neighbors matter at the tile's edges: their cover meets it there, their
// streets give its walls storefronts, their buildings shade its ground,
// their ground smooths and occludes its own. Each comes from whatever of
// them is loaded (the worker loads all eight first where they exist).

import { LAND_CELLS, LAND_CELL_M, TILE_M, type CityParts, type CityTile, type Lines, toLines } from '../format.ts'
import { type CityMesh, type PrismMesh, extrudeBuildings, extrudeMid, extrudePrisms, seedHash, seedOf } from '../extrude.ts'
import { FAR_CANOPY_CELLS, FAR_CANOPY_CELL_M, type FarTile } from '../farFormat.ts'
import { StreetFrontage } from '../frontage.ts'
import { type Grid, contactGrid, contactPixels, coverPixels, normalsAo } from '../groundShading.ts'
import { tileArrays } from '../groundTiles.ts'
import { pavingPixels } from '../paving.ts'
import { ringField } from '../ring.ts'
import { generateRooftops } from '../rooftops.ts'
import { type StreetLayers, buildStreetLayers } from '../streetMesh.ts'
import { type Ground, Terrain } from '../terrain.ts'
import type { TreesData } from '../treeFormat.ts'
import { type TreeGroup, treeGroups } from '../treeSlots.ts'
import { palette } from '../palette.ts'
import { Color } from 'three'

// The ground mesh sits this far under the true terrain (Ground.tsx).
export const TERRAIN_Y = -0.2
// The padding the ground's maps are worked out over, in 5 m samples:
// enough for the occlusion's and smoothing's blurs (groundShading.ts).
const PAD = 16
// Far blocks and canopy reach this far into the ground, so on the
// backdrop's coarser hills (Ground.tsx) none floats.
export const FAR_SINK_M = 6
// The woods' canopy: its top this far over the ground, give or take
// CANOPY_VARY (bake-trees.ts's woods are 9-16 m pines and cypresses).
const CANOPY_M = 12
const CANOPY_VARY = 0.25
const CANOPY_WALL_SHADE = 0.75

export const tileKey = (i: number, j: number) => `${i},${j}`

export interface TileContext {
  ringMeters: number
  boundary: Lines // the three neighborhoods (ring.ts)
  city: Map<string, CityTile>
  terrain: Map<string, Terrain>
  trees: Map<string, TreesData>
}

const neighborKeys = (i: number, j: number) => {
  const out: string[] = []
  for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (a || b) out.push(tileKey(i + a, j + b))
  return out
}

// The tiles' ground as one: each point from its own tile's terrain where
// that's loaded, else from `fallback` (clamped at its edge).
export function mosaic(ctx: TileContext, fallback: Terrain): Ground {
  return {
    header: { cell: fallback.header.cell },
    heightAt(x, z) {
      const t = ctx.terrain.get(tileKey(Math.floor(x / TILE_M), Math.floor(z / TILE_M))) ?? fallback
      return t.heightAt(x, z)
    },
  }
}

// How much of the ground at (x, z) is the city's land, 0..1: the tiles'
// land masks (format.ts), bilinear between cell centers across tiles; none
// where no tile is.
export function landAt(ctx: TileContext, x: number, z: number): number {
  const u = x / LAND_CELL_M - 0.5
  const v = z / LAND_CELL_M - 0.5
  const a = Math.floor(u)
  const b = Math.floor(v)
  const fu = u - a
  const fv = v - b
  const cell = (ca: number, cb: number) => {
    const ti = Math.floor(ca / LAND_CELLS)
    const tj = Math.floor(cb / LAND_CELLS)
    const t = ctx.city.get(tileKey(ti, tj))
    return t ? t.land[(cb - tj * LAND_CELLS) * LAND_CELLS + (ca - ti * LAND_CELLS)] / 255 : 0
  }
  return (cell(a, b) * (1 - fu) + cell(a + 1, b) * fu) * (1 - fv) + (cell(a, b + 1) * (1 - fu) + cell(a + 1, b + 1) * fu) * fv
}

const ringFor = (ctx: TileContext, i: number, j: number) => ringField(ctx.boundary, ctx.ringMeters, [i * TILE_M - 50, j * TILE_M - 50, (i + 1) * TILE_M + 50, (j + 1) * TILE_M + 50])

export interface GroundMesh {
  step: number
  position: Float32Array
  index: Uint16Array | Uint32Array
}

export interface BaseBuild {
  grid: Grid // the normals' and cover's: the tile's terrain grid
  normals: Uint8Array // RGBA
  cover: Uint8Array // RGBA
  paving: Uint8Array // RGBA, PAVING_SAMPLES square
  ground: GroundMesh
  streets: StreetLayers
}

function ownTerrain(ctx: TileContext, i: number, j: number): Terrain {
  const t = ctx.terrain.get(tileKey(i, j))
  if (!t) throw new Error(`tile ${i},${j}: no terrain loaded`)
  return t
}

export function groundMesh(ctx: TileContext, i: number, j: number, step: number): GroundMesh {
  const t = ownTerrain(ctx, i, j)
  return { step, ...tileArrays(t, { i0: 0, j0: 0, i1: t.header.nx - 1, j1: t.header.nz - 1 }, step, TERRAIN_Y) }
}

export function buildBase(ctx: TileContext, i: number, j: number, step: number): BaseBuild {
  const t = ownTerrain(ctx, i, j)
  const { x0, z0, cell, nx, nz } = t.header
  const ground = mosaic(ctx, t)
  // The ground's normals and occlusion over the tile and PAD samples round
  // it (from the neighbors' ground), smoothed off the city's land, then
  // cut to the tile.
  const w = nx + 2 * PAD
  const h = nz + 2 * PAD
  const heights = new Int16Array(w * h)
  const smooth = new Float32Array(w * h)
  const q = t.header.quantum
  for (let b = 0; b < h; b++)
    for (let a = 0; a < w; a++) {
      const x = x0 + (a - PAD) * cell
      const z = z0 + (b - PAD) * cell
      heights[b * w + a] = Math.round(ground.heightAt(x, z) / q)
      const off = 1 - landAt(ctx, x, z)
      smooth[b * w + a] = off * off * (3 - 2 * off)
    }
  const padded = new Terrain({ ...t.header, x0: x0 - PAD * cell, z0: z0 - PAD * cell, nx: w, nz: h }, heights)
  const all = normalsAo(padded, smooth)
  const normals = new Uint8Array(nx * nz * 4)
  for (let b = 0; b < nz; b++) normals.set(all.subarray(((b + PAD) * w + PAD) * 4, ((b + PAD) * w + PAD + nx) * 4), b * nx * 4)

  const grid: Grid = { x0, z0, cell, nx, nz }
  const covers = [tileKey(i, j), ...neighborKeys(i, j)].flatMap((k) => {
    const c = ctx.city.get(k)
    return c ? [c.cover] : []
  })
  const ringAt = ringFor(ctx, i, j)
  const city = ctx.city.get(tileKey(i, j))
  const streets = city ? city.streets : { counts: new Uint16Array(0), coords: new Float32Array(0), classes: new Uint8Array(0) }
  return {
    grid,
    normals,
    cover: coverPixels(covers, grid),
    paving: pavingPixels(x0, z0, (x, z) => landAt(ctx, x, z), ringAt),
    ground: groundMesh(ctx, i, j, step),
    streets: buildStreetLayers(streets, ground, ringAt),
  }
}

export interface NearBuild {
  buildings: CityMesh
  contact: { grid: Grid; pixels: Uint8Array }
  // Rooftop items (rooftops.ts), ROOF_FIELDS each.
  rooftops: Float32Array
  trees: TreeGroup[]
}

// x, y, z, yaw, w, d, h, kind, ring, the building's colorIndex.
export const ROOF_FIELDS = 10

const joinStreets = (parts: CityParts['streets'][]): CityParts['streets'] => {
  const lines: [number, number][][] = []
  const classes: number[] = []
  for (const s of parts) {
    let c = 0
    s.counts.forEach((n, k) => {
      const l: [number, number][] = []
      for (let p = 0; p < n; p++, c += 2) l.push([s.coords[c], s.coords[c + 1]])
      lines.push(l)
      classes.push(s.classes[k])
    })
  }
  return { ...toLines(lines), classes: Uint8Array.from(classes) }
}

export function buildNear(ctx: TileContext, i: number, j: number): NearBuild {
  const tile = ctx.city.get(tileKey(i, j))
  if (!tile) throw new Error(`tile ${i},${j}: no city loaded`)
  const ground = mosaic(ctx, ownTerrain(ctx, i, j))
  const groundAt = (x: number, z: number) => ground.heightAt(x, z)
  const around = [tileKey(i, j), ...neighborKeys(i, j)].flatMap((k) => {
    const c = ctx.city.get(k)
    return c ? [c] : []
  })
  const frontage = new StreetFrontage(joinStreets(around.map((c) => c.streets)))
  const buildings = extrudeBuildings(tile.buildings, ctx.ringMeters, tile.header.pinnedMaterials, frontage, groundAt)
  const grid = contactGrid([i * TILE_M, j * TILE_M, (i + 1) * TILE_M, (j + 1) * TILE_M], tile.buildings)
  const pixels = contactPixels(
    around.map((c) => c.buildings),
    grid,
  )
  const pieces = generateRooftops(tile.buildings, ctx.ringMeters, new Set(tile.header.pinnedMaterials.map((p) => p.building)), groundAt)
  const rooftops = new Float32Array(pieces.length * ROOF_FIELDS)
  pieces.forEach((p, k) => rooftops.set([p.x, p.y, p.z, p.yaw, p.w, p.d, p.h, p.kind, p.ring, tile.buildings.colorIndex[p.building]], k * ROOF_FIELDS))
  const trees = ctx.trees.get(tileKey(i, j))
  return { buildings, contact: { grid, pixels }, rooftops, trees: trees ? treeGroups(trees, groundAt) : [] }
}

export function buildMid(ctx: TileContext, i: number, j: number): PrismMesh {
  const tile = ctx.city.get(tileKey(i, j))
  if (!tile) throw new Error(`tile ${i},${j}: no city loaded`)
  const ground = mosaic(ctx, ownTerrain(ctx, i, j))
  return extrudeMid(tile.buildings, ctx.ringMeters, tile.header.pinnedMaterials, (x, z) => ground.heightAt(x, z))
}

// The woods' canopy over a tile's far cells: a surface CANOPY_M over the
// ground (varying by a hash of each corner's position, so neighbors agree),
// walled down to the ground where the woods end and at the tile's edge.
export interface CanopyMesh {
  position: Float32Array
  color: Float32Array // linear
  ring: Float32Array // ring.ts position, 0..1
  index: Uint32Array
}

function cornerHash(x: number, z: number): number {
  return seedOf(seedHash(Math.round(x), Math.round(z)))
}

export function buildCanopy(far: FarTile, ringAt: (x: number, z: number) => number): CanopyMesh {
  const n = FAR_CANOPY_CELLS
  const x0 = far.i * TILE_M
  const z0 = far.j * TILE_M
  const ground = new Map<number, number>()
  far.canopy.cells.forEach((c, k) => ground.set(c, far.canopy.ground[k]))
  const has = (a: number, b: number) => a >= 0 && b >= 0 && a < n && b < n && ground.has(a + b * n)
  const position: number[] = []
  const color: number[] = []
  const ring: number[] = []
  const index: number[] = []
  const deep = new Color(palette.treeGreens[1])
  const gray = new Color(palette.treeGreens[2])
  const c = new Color()
  // A corner's top and its ground: the cells around it that are woods.
  const corners = new Map<number, number>()
  const put = (x: number, y: number, z: number, shade: number) => {
    const h = cornerHash(x, z)
    c.copy(deep).lerp(gray, h * 0.6).multiplyScalar(shade * (0.9 + 0.2 * cornerHash(z, x)))
    position.push(x, y, z)
    color.push(c.r, c.g, c.b)
    ring.push(ringAt(x, z))
    return position.length / 3 - 1
  }
  const groundAtCorner = (A: number, B: number) => {
    let sum = 0
    let k = 0
    for (const [a, b] of [
      [A - 1, B - 1],
      [A, B - 1],
      [A - 1, B],
      [A, B],
    ])
      if (has(a, b)) {
        sum += ground.get(a + b * n)!
        k++
      }
    return k ? sum / k : 0
  }
  const top = (A: number, B: number) => {
    const key = A + B * (n + 1)
    let v = corners.get(key)
    if (v === undefined) {
      const x = x0 + A * FAR_CANOPY_CELL_M
      const z = z0 + B * FAR_CANOPY_CELL_M
      v = put(x, groundAtCorner(A, B) + CANOPY_M * (1 - CANOPY_VARY + 2 * CANOPY_VARY * cornerHash(x, z)), z, 1)
      corners.set(key, v)
    }
    return v
  }
  for (const cell of ground.keys()) {
    const a = cell % n
    const b = Math.floor(cell / n)
    const [t00, t10, t01, t11] = [top(a, b), top(a + 1, b), top(a, b + 1), top(a + 1, b + 1)]
    // Facing up (+y): (a, b) -> (a, b + 1) -> (a + 1, b + 1) winds counterclockwise seen from above.
    index.push(t00, t01, t11, t00, t11, t10)
    // Walls where the woods end, from the canopy down into the ground.
    const wall = (p: number, q: number) => {
      const [px, py, pz] = position.slice(3 * p, 3 * p + 3)
      const [qx, qy, qz] = position.slice(3 * q, 3 * q + 3)
      const lp = put(px, py - CANOPY_M - FAR_SINK_M, pz, CANOPY_WALL_SHADE)
      const lq = put(qx, qy - CANOPY_M - FAR_SINK_M, qz, CANOPY_WALL_SHADE)
      const up = put(px, py, pz, CANOPY_WALL_SHADE)
      const uq = put(qx, qy, qz, CANOPY_WALL_SHADE)
      index.push(lp, lq, uq, lp, uq, up)
    }
    // Edges counterclockwise round the cell seen from above, each wall facing out.
    if (!has(a, b - 1)) wall(t10, t00)
    if (!has(a + 1, b)) wall(t11, t10)
    if (!has(a, b + 1)) wall(t01, t11)
    if (!has(a - 1, b)) wall(t00, t01)
  }
  return { position: Float32Array.from(position), color: Float32Array.from(color), ring: Float32Array.from(ring), index: Uint32Array.from(index) }
}

export interface FarBuild {
  i: number
  j: number
  prisms: PrismMesh
  canopy: CanopyMesh | null
}

export function buildFar(far: FarTile, ctx: Pick<TileContext, 'ringMeters' | 'boundary'>): FarBuild {
  const p = far.prisms
  const prisms = extrudePrisms({
    counts: p.counts,
    coords: p.coords,
    base: (k) => ({ base: p.base[k] - FAR_SINK_M, height: p.height[k] + FAR_SINK_M }),
    colorIndex: p.colorIndex,
    material: () => 0,
    ring: (k) => p.ring[k],
    seed: (k) => seedOf(seedHash(Math.round(p.coords[0] * 10) + k, Math.round(p.coords[1] * 10))),
  })
  const ringAt = ringField(ctx.boundary, ctx.ringMeters, [far.i * TILE_M - 50, far.j * TILE_M - 50, (far.i + 1) * TILE_M + 50, (far.j + 1) * TILE_M + 50])
  return { i: far.i, j: far.j, prisms, canopy: far.canopy.cells.length ? buildCanopy(far, ringAt) : null }
}
