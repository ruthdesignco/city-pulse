import { use } from 'react'
import { type CityData, decodeCity } from './format.ts'
import { type Terrain, decodeTerrain } from './terrain.ts'
// Through Vite, so the build gives them content-hashed URLs that can be
// cached for good (vercel.json).
import cityUrl from '../data/city.bin?url'
import terrainUrl from '../data/terrain.bin?url'
import backdropUrl from '../data/backdrop.bin?url'

// The city and the ground it stands on, fetched together: everything that
// draws the city needs both, and one promise keeps the Suspense boundaries
// from remounting when one arrives before the other (App.tsx).
// `backdrop`: the landforms around it (bake-backdrop.ts), same format.
export type LoadedCity = CityData & { terrain: Terrain; backdrop: Terrain }

let cityPromise: Promise<LoadedCity> | undefined

const fetchBytes = (url: string, name: string, bake: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}. Run \`npm run ${bake}\` first.`)
    return res.arrayBuffer()
  })

export function loadCity(): Promise<LoadedCity> {
  cityPromise ??= Promise.all([
    fetchBytes(cityUrl, 'city.bin', 'bake'),
    fetchBytes(terrainUrl, 'terrain.bin', 'bake:terrain'),
    fetchBytes(backdropUrl, 'backdrop.bin', 'bake:backdrop'),
  ]).then(async ([city, terrain, backdrop]) => ({ ...decodeCity(city), terrain: await decodeTerrain(terrain), backdrop: await decodeTerrain(backdrop) }))
    // A rejected promise would otherwise stay cached forever: the root
    // ErrorBoundary's retry remounts this, and without clearing the cache
    // here it would suspend on the same dead promise and fail instantly.
    .catch((err: unknown) => {
      cityPromise = undefined
      throw err
    })
  return cityPromise
}

// Suspends until src/data/city.bin and terrain.bin are fetched and decoded.
export function useCity(): LoadedCity {
  return use(loadCity())
}

export function useTerrain(): Terrain {
  return useCity().terrain
}
