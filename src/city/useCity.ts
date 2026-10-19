import { use } from 'react'
import { type CityData, decodeCity } from './format.ts'

let cityPromise: Promise<CityData> | undefined

export function loadCity(): Promise<CityData> {
  cityPromise ??= fetch('/city.bin')
    .then((res) => {
      if (!res.ok) throw new Error(`city.bin: HTTP ${res.status}. Run \`npm run bake\` first.`)
      return res.arrayBuffer()
    })
    .then(decodeCity)
    // A rejected promise would otherwise stay cached forever: the root
    // ErrorBoundary's retry remounts this, and without clearing the cache
    // here it would suspend on the same dead promise and fail instantly.
    .catch((err: unknown) => {
      cityPromise = undefined
      throw err
    })
  return cityPromise
}

// Suspends until public/city.bin is fetched and decoded.
export function useCity(): CityData {
  return use(loadCity())
}
