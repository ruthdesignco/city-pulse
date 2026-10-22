// Bake the ground's height under every tile of the city (src/city/format.ts,
// cityIndex.ts) into its own terrain file (src/city/terrain.ts): a 5 m grid
// over the tile, edges shared with its neighbors, from USGS 3DEP (public
// domain): The National Map's 3DEP elevation service, which serves the best
// available DEM (1 m lidar in San Francisco) resampled to the requested
// grid, fetched in BLOCK_TILES x BLOCK_TILES tile blocks. Run after
// `npm run bake` (it reads the index's tiles).
//
//   npm run bake:terrain                    fetch if not cached, then bake
//   npm run bake:terrain -- --cached-only   bake from the cache only
//
// Fetched as raw 32-bit floats (format=bsq) over each block plus a cell, in WGS84 on square pixels of FETCH_DEG (the service widens a
// box to make its pixels square in degrees, which shifted everything when
// they weren't), cached in scripts/.cache/; then each CELL_M grid point
// averages four bilinear samples of it, a quarter cell either side. Heights are meters above
// NAVD88 (about mean sea level). Inside the Bay (bay.ts) the ground is
// held at SEA_FLOOR_M, under the water, but for its islands (Treasure and
// Yerba Buena, Alcatraz: ISLANDS), and so is anything the DEM puts at or
// below WATER_M (the Marina, the coves past the Bay's hand-drawn edge);
// everything else at least LAND_MIN_M, so
// the water (which now runs under the whole region, the backdrop's land
// standing out of it: bake-backdrop.ts) never floods low ground. Past the
// grid the backdrop carries on.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bayOutline, inBay } from '../src/city/bay.ts'
import { TILE_M } from '../src/city/format.ts'
import { Terrain, encodeTerrain } from '../src/city/terrain.ts'
import { toLatLng } from '../src/geo/projection.ts'
import { pruneLayer, readIndex, sizeReport, writeIndex, writeTileFile } from './lib/tileFiles.ts'
import { ALCATRAZ, LandMask, neighborhoodRings } from './lib/landMask.ts'

const ROOT = join(import.meta.dirname, '..')
const CACHE_DIR = join(ROOT, 'scripts/.cache')
const ENDPOINT = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'
const SOURCE = 'USGS 3D Elevation Program (3DEP), The National Map, public domain'
export const CELL_M = 5
// ~5 m north-south, ~4 m east-west.
const FETCH_DEG = 0.000045
const BLOCK_TILES = 4
const TILE_CELLS = TILE_M / CELL_M
const LAND_MIN_M = 0.6
const WATER_M = 0.3
const SEA_FLOOR_M = -1
// The Bay's islands: their ground is the DEM's, as the land's is.
const ISLANDS = new LandMask(neighborhoodRings(['Treasure Island']))
const island = (x: number, z: number) => ISLANDS.has(x, z) || (x >= ALCATRAZ.minX && x <= ALCATRAZ.maxX && z >= ALCATRAZ.minZ && z <= ALCATRAZ.maxZ)
const QUANTUM = 0.1

async function fetchDem(bbox: [number, number, number, number], w: number, h: number, cachedOnly: boolean): Promise<Float32Array> {
  const query = new URLSearchParams({
    bbox: bbox.map((v) => v.toFixed(7)).join(','),
    bboxSR: '4326',
    imageSR: '4326',
    size: `${w},${h}`,
    format: 'bsq',
    pixelType: 'F32',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  })
  const key = createHash('sha256').update(query.toString()).digest('hex').slice(0, 12)
  const file = join(CACHE_DIR, `dem-3dep-${key}.bin`)
  let bytes: Buffer
  if (existsSync(file)) {
    console.log(`terrain: cached ${file}`)
    bytes = readFileSync(file)
  } else {
    if (cachedOnly) throw new Error(`terrain: ${file} not cached; run without --cached-only`)
    console.log(`terrain: fetching ${w} x ${h} from 3DEP`)
    const res = await fetch(`${ENDPOINT}?${query}`, { headers: { 'user-agent': 'city-pulse-bake/0.1 (portfolio project; one-off bake, cached)' } })
    if (!res.ok) throw new Error(`terrain: 3DEP HTTP ${res.status}`)
    bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length < w * h * 4) throw new Error(`terrain: 3DEP sent ${bytes.length} bytes, expected ${w * h * 4}: ${bytes.subarray(0, 200).toString()}`)
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(file, bytes)
  }
  // Raw little-endian floats, rows from the north; anything after them is padding.
  const out = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) out[i] = bytes.readFloatLE(4 * i)
  return out
}

// The DEM over a box of whole FETCH_DEG pixels around scene rect [x0, x1] x
// [z0, z1] and a cell beyond it, sampled bilinearly at (lat, lng).
async function demOver(x0: number, z0: number, x1: number, z1: number, cachedOnly: boolean) {
  const nwGrid = toLatLng(x0 - CELL_M, z0 - CELL_M)
  const seGrid = toLatLng(x1 + CELL_M, z1 + CELL_M)
  const west = Math.floor(nwGrid.lng / FETCH_DEG) * FETCH_DEG
  const north = Math.ceil(nwGrid.lat / FETCH_DEG) * FETCH_DEG
  const fw = Math.ceil((seGrid.lng - west) / FETCH_DEG)
  const fh = Math.ceil((north - seGrid.lat) / FETCH_DEG)
  const dem = await fetchDem([west, north - fh * FETCH_DEG, west + fw * FETCH_DEG, north], fw, fh, cachedOnly)
  // Pixel centers are half a pixel in from the box's edges.
  return (lat: number, lng: number): number | null => {
    const u = (lng - west) / FETCH_DEG - 0.5
    const v = (north - lat) / FETCH_DEG - 0.5
    const i = Math.max(0, Math.min(fw - 2, Math.floor(u)))
    const j = Math.max(0, Math.min(fh - 2, Math.floor(v)))
    const fu = Math.min(1, Math.max(0, u - i))
    const fv = Math.min(1, Math.max(0, v - j))
    const p = [dem[j * fw + i], dem[j * fw + i + 1], dem[(j + 1) * fw + i], dem[(j + 1) * fw + i + 1]]
    if (p.some((x) => !Number.isFinite(x) || x < -100 || x > 1000)) return null
    return (p[0] * (1 - fu) + p[1] * fu) * (1 - fv) + (p[2] * (1 - fu) + p[3] * fu) * fv
  }
}

async function main() {
  const cachedOnly = process.argv.includes('--cached-only')
  const index = readIndex()
  const bay = bayOutline()
  const blocks = new Map<string, typeof index.tiles>()
  for (const t of index.tiles) {
    const k = `${Math.floor(t.i / BLOCK_TILES)},${Math.floor(t.j / BLOCK_TILES)}`
    blocks.set(k, [...(blocks.get(k) ?? []), t])
  }
  let lo = Infinity
  let hi = -Infinity
  let noData = 0
  const n = TILE_CELLS + 1
  const terrains = new Map<string, Terrain>()
  for (const [k, tiles] of blocks) {
    const [bi, bj] = k.split(',').map(Number)
    const sample = await demOver(bi * BLOCK_TILES * TILE_M, bj * BLOCK_TILES * TILE_M, (bi + 1) * BLOCK_TILES * TILE_M, (bj + 1) * BLOCK_TILES * TILE_M, cachedOnly)
    for (const t of tiles) {
      const x0 = t.i * TILE_M
      const z0 = t.j * TILE_M
      const heights = new Int16Array(n * n)
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const x = x0 + i * CELL_M
          const z = z0 + j * CELL_M
          // Four bilinear samples a quarter cell either side, averaged.
          let sum = 0
          let got = 0
          for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
            const ll = toLatLng(x + (dx * CELL_M) / 4, z + (dz * CELL_M) / 4)
            const v = sample(ll.lat, ll.lng)
            if (v === null) noData++
            else {
              sum += v
              got++
            }
          }
          let h = got ? sum / got : 0
          h = (inBay(x, z, bay) && !island(x, z)) || (got > 0 && h <= WATER_M) ? SEA_FLOOR_M : Math.max(LAND_MIN_M, h)
          heights[j * n + i] = Math.round(h / QUANTUM)
          lo = Math.min(lo, h)
          hi = Math.max(hi, h)
        }
      const terrain = new Terrain(
        { version: 2, x0, z0, cell: CELL_M, nx: n, nz: n, quantum: QUANTUM, source: SOURCE, datum: 'NAVD88 meters', bakedAt: new Date().toISOString() },
        heights,
      )
      terrains.set(`${t.i},${t.j}`, terrain)
      t.files.terrain = writeTileFile('terrain', t.i, t.j, await encodeTerrain(terrain))
    }
  }
  index.sources.terrain = SOURCE
  writeIndex(index)
  const removed = pruneLayer(index, 'terrain')
  const probe = (name: string, x: number, z: number) => {
    const t = terrains.get(`${Math.floor(x / TILE_M)},${Math.floor(z / TILE_M)}`)
    return `${name} ${t ? t.heightAt(x, z).toFixed(1) : '?'} m`
  }
  const coit = index.landmarkModels.find((m) => m.id === 'coit')
  console.log(`terrain: ${index.tiles.length} tiles of ${n} x ${n} at ${CELL_M} m; ${lo.toFixed(1)} to ${hi.toFixed(1)} m; ${noData} no-data samples; ${removed} stale files removed`)
  console.log(`  ${[coit ? probe('Coit Tower', coit.x, coit.z) : '', probe('origin', 0, 0), probe('Twin Peaks', -3057, 1509)].filter(Boolean).join(', ')}`)
  console.log(sizeReport(index, ['city', 'terrain', 'trees']))
}

await main()
