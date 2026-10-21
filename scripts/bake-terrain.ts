// Bake the ground's height for the bake area into src/data/terrain.bin
// (src/city/terrain.ts), from USGS 3DEP (public domain): The National Map's
// 3DEP elevation service, which serves the best available DEM (1 m lidar
// in San Francisco) resampled to the requested grid. Run after
// `npm run bake` (it reads city.bin's data extent).
//
//   npm run bake:terrain                    fetch if not cached, then bake
//   npm run bake:terrain -- --cached-only   bake from the cache only
//
// Fetched as raw 32-bit floats (format=bsq) over the data extent plus
// MARGIN_M, in WGS84 on square pixels of FETCH_DEG (the service widens a
// box to make its pixels square in degrees, which shifted everything when
// they weren't), cached in scripts/.cache/; then each CELL_M grid point
// averages four bilinear samples of it, a quarter cell either side. Heights are meters above
// NAVD88 (about mean sea level). Inside the Bay (bay.ts) the ground is
// held at SEA_FLOOR_M, under the water; over the outer TAPER_M of the grid
// the heights ease down to sea level, where the flat land beyond takes over
// (Ground.tsx).

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bayOutline, inBay } from '../src/city/bay.ts'
import { decodeCity } from '../src/city/format.ts'
import { Terrain, encodeTerrain } from '../src/city/terrain.ts'
import { toLatLng } from '../src/geo/projection.ts'

const ROOT = join(import.meta.dirname, '..')
const CACHE_DIR = join(ROOT, 'scripts/.cache')
const OUT = join(ROOT, 'src/data/terrain.bin')
const ENDPOINT = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage'
const SOURCE = 'USGS 3D Elevation Program (3DEP), The National Map, public domain'
export const CELL_M = 5
// ~5 m north-south, ~4 m east-west.
const FETCH_DEG = 0.000045
const MARGIN_M = 500
const TAPER_M = 300
const SEA_FLOOR_M = -1
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

async function main() {
  const cityBytes = readFileSync(join(ROOT, 'src/data/city.bin'))
  const city = decodeCity(cityBytes.buffer.slice(cityBytes.byteOffset, cityBytes.byteOffset + cityBytes.byteLength))
  const extent = city.header.extent
  if (!extent) throw new Error('terrain: city.bin has no data extent; rebake the city first')
  // The grid on a CELL_M lattice from the scene origin, so the paving grid
  // (paving.ts) shares its points.
  const x0 = Math.floor((extent[0] - MARGIN_M) / CELL_M) * CELL_M
  const z0 = Math.floor((extent[1] - MARGIN_M) / CELL_M) * CELL_M
  const nx = Math.ceil((extent[2] + MARGIN_M - x0) / CELL_M) + 1
  const nz = Math.ceil((extent[3] + MARGIN_M - z0) / CELL_M) + 1
  // A box of whole FETCH_DEG pixels around the grid, a cell beyond it.
  const nwGrid = toLatLng(x0 - CELL_M, z0 - CELL_M)
  const seGrid = toLatLng(x0 + nx * CELL_M, z0 + nz * CELL_M)
  const west = Math.floor(nwGrid.lng / FETCH_DEG) * FETCH_DEG
  const north = Math.ceil(nwGrid.lat / FETCH_DEG) * FETCH_DEG
  const fw = Math.ceil((seGrid.lng - west) / FETCH_DEG)
  const fh = Math.ceil((north - seGrid.lat) / FETCH_DEG)
  const dem = await fetchDem([west, north - fh * FETCH_DEG, west + fw * FETCH_DEG, north], fw, fh, process.argv.includes('--cached-only'))
  // Bilinear at (lat, lng): pixel centers are half a pixel in from the box's edges.
  const sample = (lat: number, lng: number): number | null => {
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

  const bay = bayOutline()
  const heights = new Int16Array(nx * nz)
  let lo = Infinity
  let hi = -Infinity
  let noData = 0
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = x0 + i * CELL_M
      const z = z0 + j * CELL_M
      let sum = 0
      let n = 0
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const ll = toLatLng(x + (dx * CELL_M) / 4, z + (dz * CELL_M) / 4)
        const v = sample(ll.lat, ll.lng)
        if (v === null) noData++
        else {
          sum += v
          n++
        }
      }
      let h = n ? sum / n : 0
      if (inBay(x, z, bay)) h = SEA_FLOOR_M
      // Ease to sea level over the grid's outer TAPER_M.
      const edge = Math.min(x - x0, z - z0, x0 + (nx - 1) * CELL_M - x, z0 + (nz - 1) * CELL_M - z)
      const t = Math.min(1, edge / TAPER_M)
      h *= t * t * (3 - 2 * t)
      heights[j * nx + i] = Math.round(h / QUANTUM)
      lo = Math.min(lo, h)
      hi = Math.max(hi, h)
    }

  const terrain = new Terrain(
    { version: 2, x0, z0, cell: CELL_M, nx, nz, quantum: QUANTUM, source: SOURCE, datum: 'NAVD88 meters', bakedAt: new Date().toISOString() },
    heights,
  )
  const bytes = await encodeTerrain(terrain)
  writeFileSync(OUT, bytes)
  const probe = (name: string, x: number, z: number) => `${name} ${terrain.heightAt(x, z).toFixed(1)} m`
  const coit = city.header.landmarkModels?.find((m) => m.id === 'coit')
  console.log(`terrain: ${nx} x ${nz} at ${CELL_M} m from (${x0}, ${z0}); ${lo.toFixed(1)} to ${hi.toFixed(1)} m; ${noData} no-data samples`)
  console.log(`  ${[coit ? probe('Coit Tower', coit.x, coit.z) : '', probe('origin', 0, 0)].filter(Boolean).join(', ')}`)
  console.log(`src/data/terrain.bin: ${(bytes.length / 1024).toFixed(0)} KB (gzipped inside; ${((2 * nx * nz) / 1024).toFixed(0)} KB of heights)`)
}

await main()
