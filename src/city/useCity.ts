import { use } from 'react'
import type { CityIndex } from './cityIndex.ts'
import { type Lines, toLines } from './format.ts'
import { type LandCover, decodeLandCover } from './landCover.ts'
import { Terrain, type TerrainHeader, decodeTerrain } from './terrain.ts'
// Through Vite, so the build gives them content-hashed URLs that can be
// cached for good (vercel.json); the tiles' files carry their own hashes.
import indexUrl from '../data/city-index.json?url'
import backdropUrl from '../data/backdrop.bin?url'
import landCoverUrl from '../data/landcover.bin?url'

// What's city-wide, fetched together before any tile: the index
// (cityIndex.ts), the landforms around the city (bake-backdrop.ts, the
// terrain format) and what that land is (bake-landcover.ts). The tiles
// themselves stream in by distance (stream/TileStream.ts).
export interface CityBase {
  index: CityIndex
  boundary: Lines // the three neighborhoods (ring.ts)
  backdrop: Terrain
  landCover: LandCover
}

// The backdrop is drawn this far down (Ground.tsx): past the city's
// terrain grids, which ease to sea level at their edges, it lies under them.
export const LAND_Y = -0.6

export const tileUrl = (file: string) => `${import.meta.env.BASE_URL}tiles/${file}`

let basePromise: Promise<CityBase> | undefined

const fetchBytes = (url: string, name: string, bake: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}. Run \`npm run ${bake}\` first.`)
    return res.arrayBuffer()
  })

async function load(): Promise<CityBase> {
  const [index, backdrop, landCover] = await Promise.all([
    fetchBytes(indexUrl, 'city-index.json', 'bake').then((b) => JSON.parse(new TextDecoder().decode(b)) as CityIndex),
    fetchBytes(backdropUrl, 'backdrop.bin', 'bake:backdrop').then(decodeTerrain),
    fetchBytes(landCoverUrl, 'landcover.bin', 'bake:landcover').then(decodeLandCover),
  ])
  if (index.tiles.length === 0) throw new Error('city-index.json: no tiles. Run `npm run bake` first.')
  const boundary = toLines(index.boundary.map((r) => Array.from({ length: r.length / 2 }, (_, k): [number, number] => [r[2 * k], r[2 * k + 1]])))
  cityGround.setBackdrop(backdrop, index.tileM)
  return { index, boundary, backdrop, landCover }
}

export function loadCityBase(): Promise<CityBase> {
  basePromise ??= load()
    // A rejected promise would otherwise stay cached forever: the root
    // ErrorBoundary's retry remounts this, and without clearing the cache
    // here it would suspend on the same dead promise and fail instantly.
    .catch((err: unknown) => {
      basePromise = undefined
      throw err
    })
  return basePromise
}

// Suspends until the index, backdrop and land cover are in.
export function useCityBase(): CityBase {
  return use(loadCityBase())
}

// The ground's height anywhere, for what stands on it outside the tiles'
// own meshes (the camera, the vehicles): from a tile's 5 m terrain once a
// worker has it (stream/tileWorker.ts sends a copy), the backdrop's 50 m
// grid before that and past the tiles.
class CityGround {
  private tiles = new Map<string, Terrain>()
  private backdrop: Terrain | null = null
  private tileM = 1000
  private waiting: { keys: string[]; done: () => void }[] = []

  setBackdrop(b: Terrain, tileM: number) {
    this.backdrop = b
    this.tileM = tileM
  }

  setTile(key: string, header: TerrainHeader, heights: Int16Array) {
    this.tiles.set(key, new Terrain(header, heights))
    this.waiting = this.waiting.filter((w) => {
      if (!w.keys.every((k) => this.tiles.has(k))) return true
      w.done()
      return false
    })
  }

  keyAt(x: number, z: number): string {
    return `${Math.floor(x / this.tileM)},${Math.floor(z / this.tileM)}`
  }

  heightAt(x: number, z: number): number {
    const t = this.tiles.get(this.keyAt(x, z))
    if (t) return t.heightAt(x, z)
    return this.backdrop ? this.backdrop.heightAt(x, z) + LAND_Y : 0
  }

  // Resolves once the tiles under all of `keys` have their terrain.
  whenTiles(keys: string[]): Promise<void> {
    if (keys.every((k) => this.tiles.has(k))) return Promise.resolve()
    return new Promise((done) => this.waiting.push({ keys, done }))
  }
}

export const cityGround = new CityGround()
