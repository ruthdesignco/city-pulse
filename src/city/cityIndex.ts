// The baked city's index (src/data/city-index.json): what's city-wide, and
// every tile (format.ts) with its files in public/tiles/, each written by
// its own bake: the city's parts (bake-city.ts), its ground (5 m terrain,
// bake-terrain.ts), its trees (bake-trees.ts). File names carry a hash of
// their contents, so they can be cached for good (vercel.json); `bytes` is
// each file's size as served, which the load report adds up.

import type { LatLng } from '../geo/projection.ts'
import type { Landmark } from './format.ts'
import type { LandmarkPlacement } from './landmarks/registry.ts'

export const INDEX_VERSION = 1

export type TileLayer = 'city' | 'terrain' | 'trees'

export interface TileFile {
  file: string // under public/tiles/
  bytes: number
}

export interface TileEntry {
  i: number
  j: number
  buildings: number
  // How much of the tile is San Francisco's land (0..1, on a 50 m lattice).
  land: number
  files: Partial<Record<TileLayer, TileFile>>
}

export interface CityIndex {
  version: typeof INDEX_VERSION
  origin: LatLng
  tileM: number
  ringMeters: number
  // The three neighborhoods, each ring x, z interleaved in scene meters.
  boundary: number[][]
  waterfront: [number, number][]
  landmarks: Landmark[]
  landmarkModels: LandmarkPlacement[]
  attribution: string
  osmTimestamp: string | null
  osmElementsSha256: string
  bakedAt: string
  // Each layer's own provenance line (source, date), set by its bake.
  sources: Partial<Record<TileLayer, string>>
  tiles: TileEntry[]
}

export const tileKey = (i: number, j: number) => `${i},${j}`
