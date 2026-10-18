import { use } from 'react'
import { type CityData, decodeCity } from './format.ts'

let cityPromise: Promise<CityData> | undefined

function loadCity(): Promise<CityData> {
  cityPromise ??= fetch('/city.bin')
    .then((res) => {
      if (!res.ok) throw new Error(`city.bin: HTTP ${res.status}. Run \`npm run bake\` first.`)
      return res.arrayBuffer()
    })
    .then(decodeCity)
  return cityPromise
}

// Suspends until public/city.bin is fetched and decoded.
export function useCity(): CityData {
  return use(loadCity())
}
