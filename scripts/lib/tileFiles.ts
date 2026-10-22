// Reading and writing the baked city's tiles (src/city/format.ts) and its
// index (src/city/cityIndex.ts): each bake writes its own layer's files
// into public/tiles/, named <layer>-<i>_<j>-<hash>.bin by their contents
// (cached for good: vercel.json), drops that layer's files no tile lists
// any more, and records them in src/data/city-index.json.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { type CityIndex, type TileFile, type TileLayer, tileKey } from '../../src/city/cityIndex.ts'

const ROOT = join(import.meta.dirname, '../..')
export const TILES_DIR = join(ROOT, 'public/tiles')
export const INDEX_PATH = join(ROOT, 'src/data/city-index.json')

export function readIndex(): CityIndex {
  if (!existsSync(INDEX_PATH)) throw new Error(`${INDEX_PATH} not found: run \`npm run bake\` first`)
  return JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as CityIndex
}

export function readIndexIfAny(): CityIndex | null {
  return existsSync(INDEX_PATH) ? readIndex() : null
}

export function writeIndex(index: CityIndex) {
  writeFileSync(INDEX_PATH, `${JSON.stringify(index)}\n`)
}

export function readTileFile(file: string): ArrayBuffer {
  const b = readFileSync(join(TILES_DIR, file))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}

export function writeTileFile(layer: TileLayer, i: number, j: number, bytes: Uint8Array): TileFile {
  mkdirSync(TILES_DIR, { recursive: true })
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10)
  const file = `${layer}-${i}_${j}-${hash}.bin`
  writeFileSync(join(TILES_DIR, file), bytes)
  return { file, bytes: bytes.length }
}

// Removes the layer's files that `index` no longer lists.
export function pruneLayer(index: CityIndex, layer: TileLayer): number {
  if (!existsSync(TILES_DIR)) return 0
  const keep = new Set(index.tiles.flatMap((t) => (t.files[layer] ? [t.files[layer].file] : [])))
  let removed = 0
  for (const f of readdirSync(TILES_DIR))
    if (f.startsWith(`${layer}-`) && !keep.has(f)) {
      rmSync(join(TILES_DIR, f))
      removed++
    }
  return removed
}

// A table of each tile's files and their sizes, and the totals, for the
// bakes' reports.
export function sizeReport(index: CityIndex, layers: TileLayer[]): string {
  const kb = (n: number) => (n / 1024).toFixed(1).padStart(7)
  const totals = Object.fromEntries(layers.map((l) => [l, 0])) as Record<TileLayer, number>
  const rows = [...index.tiles]
    .sort((a, b) => a.j - b.j || a.i - b.i)
    .map((t) => {
      const cells = layers.map((l) => {
        const n = t.files[l]?.bytes ?? 0
        totals[l] += n
        return kb(n)
      })
      return `  ${tileKey(t.i, t.j).padEnd(7)} ${String(t.buildings).padStart(6)} ${(t.land * 100).toFixed(0).padStart(4)}%  ${cells.join(' ')}`
    })
  const all = layers.reduce((n, l) => n + totals[l], 0)
  return [
    `  tile    bldgs  land  ${layers.map((l) => `${l} KB`.padStart(7)).join(' ')}`,
    ...rows,
    `  total ${index.tiles.length} tiles   ${layers.map((l) => kb(totals[l])).join(' ')}   all ${(all / 1024 / 1024).toFixed(2)} MB`,
  ].join('\n')
}
