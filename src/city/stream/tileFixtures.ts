// Small real tiles for tests (tileBuild.test.ts, TileStream.test.ts): two
// side by side, (0, 0) and (1, 0), both the city's land; flat ground at
// 10 m. Tile (0, 0) has a 30 x 20 m building, 20 m tall, by a street, and a
// wood in its southeast corner; its far blocks are the same building and
// three cells of the wood's canopy.

import { type CityTile, CoverClass, LAND_CELLS, toLines } from '../format.ts'
import { FAR_CANOPY_CELLS, type FarTile } from '../farFormat.ts'
import { Terrain } from '../terrain.ts'
import { type TreesData } from '../treeFormat.ts'
import type { TileContext } from './tileBuild.ts'

export const square = (x: number, z: number, w: number, d: number): [number, number][] => [
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

export const ctx: TileContext = {
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

export const farTile = (): FarTile => ({
  i: 0,
  j: 0,
  prisms: { ...toLines([square(400, 400, 30, 20)]), base: Float32Array.of(10), height: Float32Array.of(20), colorIndex: Uint8Array.of(3), ring: Float32Array.of(0) },
  canopy: { cells: Uint16Array.of(0, 1, FAR_CANOPY_CELLS), ground: Float32Array.of(10, 10, 10) },
})
