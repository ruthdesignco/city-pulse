// Bake the landforms around the city (src/data/backdrop.bin, the same
// format as terrain.bin: src/city/terrain.ts) for a low-detail backdrop:
// the Marin Headlands and Mt Tamalpais, Angel Island, Alcatraz, Yerba Buena
// Island, Twin Peaks and the rest of the peninsula, the East Bay hills. From
// USGS 3DEP (public domain) at CELL_M, over BBOX. Context only: no
// buildings; the city's own 5 m terrain (bake-terrain.ts) covers the bake
// area, the backdrop sinking out of sight under it (Ground.tsx).
//
//   npm run bake:backdrop                    fetch if not cached, then bake
//   npm run bake:backdrop -- --cached-only   bake from the cache only
//
// The elevation service has no water: anything at or below WATER_M is
// sea, held at SEA_FLOOR_M under the water, which runs under the whole
// region (BayWater.tsx); everything above it stands out as land.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Terrain, encodeTerrain } from '../src/city/terrain.ts'
import { toLatLng, toScene } from '../src/geo/projection.ts'

const ROOT = join(import.meta.dirname, '..')
const CACHE_DIR = join(ROOT, 'scripts/.cache')
const OUT = join(ROOT, 'src/data/backdrop.bin')
const ENDPOINT = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'
const SOURCE = 'USGS 3D Elevation Program (3DEP), The National Map, public domain'
export const BBOX = { south: 37.6, west: -122.62, north: 37.95, east: -122.12 }
export const CELL_M = 50
const FETCH_DEG = 0.0006 // ~67 m north-south, ~53 m east-west
const WATER_M = 0.3
const SEA_FLOOR_M = -3
const QUANTUM = 0.1

async function main() {
  const cachedOnly = process.argv.includes('--cached-only')
  const w = Math.round((BBOX.east - BBOX.west) / FETCH_DEG)
  const h = Math.round((BBOX.north - BBOX.south) / FETCH_DEG)
  const query = new URLSearchParams({
    bbox: [BBOX.west, BBOX.north - h * FETCH_DEG, BBOX.west + w * FETCH_DEG, BBOX.north].map((v) => v.toFixed(7)).join(','),
    bboxSR: '4326',
    imageSR: '4326',
    size: `${w},${h}`,
    format: 'bsq',
    pixelType: 'F32',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  })
  const file = join(CACHE_DIR, `dem-3dep-${createHash('sha256').update(query.toString()).digest('hex').slice(0, 12)}.bin`)
  let bytes: Buffer
  if (existsSync(file)) bytes = readFileSync(file)
  else {
    if (cachedOnly) throw new Error(`backdrop: ${file} not cached; run without --cached-only`)
    console.log(`backdrop: fetching ${w} x ${h} from 3DEP`)
    const res = await fetch(`${ENDPOINT}?${query}`, { headers: { 'user-agent': 'city-pulse-bake/0.1 (portfolio project; one-off bake, cached)' } })
    if (!res.ok) throw new Error(`backdrop: 3DEP HTTP ${res.status}`)
    bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length < w * h * 4) throw new Error(`backdrop: 3DEP sent ${bytes.length} bytes, expected ${w * h * 4}`)
    mkdirSync(CACHE_DIR, { recursive: true })
    writeFileSync(file, bytes)
  }
  const dem = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) dem[i] = bytes.readFloatLE(4 * i)
  const sample = (lat: number, lng: number): number => {
    const u = (lng - BBOX.west) / FETCH_DEG - 0.5
    const v = (BBOX.north - lat) / FETCH_DEG - 0.5
    const i = Math.max(0, Math.min(w - 2, Math.floor(u)))
    const j = Math.max(0, Math.min(h - 2, Math.floor(v)))
    const fu = Math.min(1, Math.max(0, u - i))
    const fv = Math.min(1, Math.max(0, v - j))
    const p = [dem[j * w + i], dem[j * w + i + 1], dem[(j + 1) * w + i], dem[(j + 1) * w + i + 1]].map((x) => (Number.isFinite(x) && x > -100 && x < 2000 ? x : 0))
    return (p[0] * (1 - fu) + p[1] * fu) * (1 - fv) + (p[2] * (1 - fu) + p[3] * fu) * fv
  }

  // A CELL_M grid in scene meters over the box, on a lattice from the origin.
  const nw = toScene(BBOX.north, BBOX.west)
  const se = toScene(BBOX.south, BBOX.east)
  const x0 = Math.ceil(nw.x / CELL_M) * CELL_M
  const z0 = Math.ceil(nw.z / CELL_M) * CELL_M
  const nx = Math.floor((se.x - x0) / CELL_M) + 1
  const nz = Math.floor((se.z - z0) / CELL_M) + 1
  const heights = new Int16Array(nx * nz)
  let land = 0
  let hi = 0
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const ll = toLatLng(x0 + i * CELL_M, z0 + j * CELL_M)
      const v = sample(ll.lat, ll.lng)
      const hm = v > WATER_M ? v : SEA_FLOOR_M
      if (v > WATER_M) land++
      hi = Math.max(hi, hm)
      heights[j * nx + i] = Math.round(hm / QUANTUM)
    }
  const terrain = new Terrain({ version: 2, x0, z0, cell: CELL_M, nx, nz, quantum: QUANTUM, source: SOURCE, datum: 'NAVD88 meters', bakedAt: new Date().toISOString() }, heights)
  const out = await encodeTerrain(terrain)
  writeFileSync(OUT, out)
  const probe = (name: string, lat: number, lng: number) => {
    const p = toScene(lat, lng)
    return `${name} ${terrain.heightAt(p.x, p.z).toFixed(0)} m`
  }
  console.log(`backdrop: ${nx} x ${nz} at ${CELL_M} m from (${x0}, ${z0}); ${((100 * land) / (nx * nz)).toFixed(0)}% land, highest ${hi.toFixed(0)} m`)
  console.log(
    `  ${[probe('Mt Tamalpais', 37.9235, -122.5965), probe('Hawk Hill', 37.8257, -122.4985), probe('Angel Island', 37.8616, -122.4318), probe('Alcatraz', 37.8267, -122.4230), probe('Yerba Buena Island', 37.8092, -122.3646), probe('Twin Peaks', 37.7525, -122.4476), probe('Grizzly Peak', 37.8818, -122.2338), probe('the Golden Gate', 37.8199, -122.4783)].join(', ')}`,
  )
  console.log(`src/data/backdrop.bin: ${(out.length / 1024).toFixed(0)} KB`)
}

await main()
