// The shipped city (src/data/city-index.json and its tiles in public/tiles/),
// read whole, for the tests that check what's baked.

import { statSync } from 'node:fs'
import { join } from 'node:path'
import type { CityIndex } from '../../src/city/cityIndex.ts'
import { type CityTile, decodeTile, joinParts } from '../../src/city/format.ts'
import { type Terrain, decodeTerrain } from '../../src/city/terrain.ts'
import { type TreesData, decodeTrees } from '../../src/city/treeFormat.ts'
import { TILES_DIR, readIndex, readTileFile } from './tileFiles.ts'

export interface ShippedCity {
  index: CityIndex
  tiles: CityTile[]
  city: ReturnType<typeof joinParts>
  terrain: Map<string, Terrain>
  trees: TreesData[]
  // The ground's height at (x, z), from its tile's terrain.
  heightAt(x: number, z: number): number
  // A tile file's size on disk.
  fileBytes(file: string): number
}

export async function loadShippedCity(): Promise<ShippedCity> {
  const index = readIndex()
  const tiles: CityTile[] = []
  const terrain = new Map<string, Terrain>()
  const trees: TreesData[] = []
  for (const t of index.tiles) {
    if (t.files.city) tiles.push(await decodeTile(readTileFile(t.files.city.file)))
    if (t.files.terrain) terrain.set(`${t.i},${t.j}`, await decodeTerrain(readTileFile(t.files.terrain.file)))
    if (t.files.trees) trees.push(await decodeTrees(readTileFile(t.files.trees.file)))
  }
  const m = index.tileM
  return {
    index,
    tiles,
    city: joinParts(tiles),
    terrain,
    trees,
    heightAt(x, z) {
      const t = terrain.get(`${Math.floor(x / m)},${Math.floor(z / m)}`)
      if (!t) throw new Error(`no terrain tile at ${x.toFixed(0)}, ${z.toFixed(0)}`)
      return t.heightAt(x, z)
    },
    fileBytes: (file) => statSync(join(TILES_DIR, file)).size,
  }
}
