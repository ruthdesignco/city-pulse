import { use } from 'react'
import type { CityIndex, TileEntry, TileLayer } from './cityIndex.ts'
import { type CityData, type CityTile, decodeTile, joinParts, toLines } from './format.ts'
import { type LandCover, decodeLandCover } from './landCover.ts'
import { type Terrain, decodeTerrain, stitchTerrain } from './terrain.ts'
// Through Vite, so the build gives them content-hashed URLs that can be
// cached for good (vercel.json); the tiles' files carry their own hashes.
import indexUrl from '../data/city-index.json?url'
import backdropUrl from '../data/backdrop.bin?url'
import landCoverUrl from '../data/landcover.bin?url'

// The city (format.ts, cityIndex.ts): the index, then the tiles over
// LOAD_EXTENT, their parts and 5 m ground, fetched together (everything
// that draws the city needs both, and one promise keeps the Suspense
// boundaries from remounting when one arrives before the other: App.tsx).
// The tiles' parts are also joined as one city, for what works on it
// whole; `tiles` keeps them apart, for what's drawn tile by tile.
// `backdrop`: the landforms around it (bake-backdrop.ts), the terrain
// format; `landCover`: what that land is (bake-landcover.ts).
export type LoadedCity = CityData & {
  index: CityIndex
  tiles: CityTile[]
  terrain: Terrain
  backdrop: Terrain
  landCover: LandCover
  // What each layer's tiles cost to download, bytes.
  bytes: Partial<Record<TileLayer, number>>
}

// SoMa, the Mission and the Tenderloin with the ring around them, and the
// waterfront north to the Bay (scene m, [minX, minZ, maxX, maxZ]): the area
// baked before the city went to tiles. The rest of the city is baked, and
// comes in with streaming.
export const LOAD_EXTENT: [number, number, number, number] = [-2088, -4606, 2687, 3108]
// Under the Bay and the ocean, where no tile has ground: the bake's sea floor.
const SEA_FLOOR_M = -1

export const tileUrl = (file: string) => `${import.meta.env.BASE_URL}tiles/${file}`

let cityPromise: Promise<LoadedCity> | undefined

const fetchBytes = (url: string, name: string, bake: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}. Run \`npm run ${bake}\` first.`)
    return res.arrayBuffer()
  })

export function loadIndex(): Promise<CityIndex> {
  return fetchBytes(indexUrl, 'city-index.json', 'bake').then((b) => JSON.parse(new TextDecoder().decode(b)) as CityIndex)
}

// The tiles over an extent.
export function tilesIn(index: CityIndex, [minX, minZ, maxX, maxZ]: [number, number, number, number]): TileEntry[] {
  const m = index.tileM
  return index.tiles.filter((t) => (t.i + 1) * m > minX && t.i * m < maxX && (t.j + 1) * m > minZ && t.j * m < maxZ)
}

async function load(): Promise<LoadedCity> {
  const index = await loadIndex()
  const entries = tilesIn(index, LOAD_EXTENT)
  if (entries.length === 0) throw new Error('city-index.json: no tiles. Run `npm run bake` first.')
  const bytes: Partial<Record<TileLayer, number>> = {}
  const fetchLayer = (t: TileEntry, layer: TileLayer, bake: string) => {
    const f = t.files[layer]
    if (!f) throw new Error(`tile ${t.i},${t.j}: no ${layer} file. Run \`npm run ${bake}\` first.`)
    bytes[layer] = (bytes[layer] ?? 0) + f.bytes
    return fetchBytes(tileUrl(f.file), f.file, bake)
  }
  const [tiles, grounds, backdrop, landCover] = await Promise.all([
    Promise.all(entries.map((t) => fetchLayer(t, 'city', 'bake').then(decodeTile))),
    Promise.all(entries.map((t) => fetchLayer(t, 'terrain', 'bake:terrain').then(decodeTerrain))),
    fetchBytes(backdropUrl, 'backdrop.bin', 'bake:backdrop').then(decodeTerrain),
    fetchBytes(landCoverUrl, 'landcover.bin', 'bake:landcover').then(decodeLandCover),
  ])
  const m = index.tileM
  const i0 = Math.min(...entries.map((t) => t.i))
  const j0 = Math.min(...entries.map((t) => t.j))
  const i1 = Math.max(...entries.map((t) => t.i))
  const j1 = Math.max(...entries.map((t) => t.j))
  const terrain = stitchTerrain(new Map(entries.map((t, k) => [`${t.i},${t.j}`, grounds[k]])), i0, j0, i1, j1, m, SEA_FLOOR_M)
  const { pinnedMaterials, ...parts } = joinParts(tiles)
  const boundary = toLines(index.boundary.map((r) => Array.from({ length: r.length / 2 }, (_, k): [number, number] => [r[2 * k], r[2 * k + 1]])))
  console.info(`city: ${tiles.length} tiles, ${Object.entries(bytes).map(([l, n]) => `${l} ${(n / 1024).toFixed(0)} KB`).join(', ')}`)
  return {
    index,
    tiles,
    terrain,
    backdrop,
    landCover,
    bytes,
    ...parts,
    boundary,
    header: {
      origin: index.origin,
      ringMeters: index.ringMeters,
      waterfront: index.waterfront,
      extent: [i0 * m, j0 * m, (i1 + 1) * m, (j1 + 1) * m],
      pinnedMaterials,
      landmarkModels: index.landmarkModels,
      attribution: index.attribution,
      osmTimestamp: index.osmTimestamp,
      osmElementsSha256: index.osmElementsSha256,
      bakedAt: index.bakedAt,
      landmarks: index.landmarks,
    },
  }
}

export function loadCity(): Promise<LoadedCity> {
  cityPromise ??= load()
    // A rejected promise would otherwise stay cached forever: the root
    // ErrorBoundary's retry remounts this, and without clearing the cache
    // here it would suspend on the same dead promise and fail instantly.
    .catch((err: unknown) => {
      cityPromise = undefined
      throw err
    })
  return cityPromise
}

// Suspends until the city's tiles are fetched and decoded.
export function useCity(): LoadedCity {
  return use(loadCity())
}

export function useTerrain(): Terrain {
  return useCity().terrain
}
