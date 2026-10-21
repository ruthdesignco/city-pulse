// What a rebake changes, printed before it overwrites the committed file
// (bake-city.ts, bake-trees.ts), so drift from a newer OpenStreetMap or
// DataSF is expected but never silent. A building's look (stone or glass,
// storefront, rooftop) hashes off its facade seed, its first footprint
// vertex (extrude.ts), so a new seed can mean a new look.

import type { CityData } from '../../src/city/format.ts'

export interface CityChange {
  buildings: [number, number]
  streets: [number, number]
  // Buildings whose seed wasn't in the old bake: new, or redrawn in OSM.
  newSeeds: number
}

function seeds(b: CityData['buildings']): number[] {
  return Array.from(b.seeds)
}

export function compareCities(before: CityData, after: CityData): CityChange {
  const old = new Set(seeds(before.buildings))
  return {
    buildings: [before.buildings.counts.length, after.buildings.counts.length],
    streets: [before.streets.counts.length, after.streets.counts.length],
    newSeeds: seeds(after.buildings).filter((s) => !old.has(s)).length,
  }
}

export function describeCityChange(c: CityChange): string {
  const d = (a: number, b: number) => `${a} -> ${b} (${b - a >= 0 ? '+' : ''}${b - a})`
  return `buildings ${d(...c.buildings)}, streets ${d(...c.streets)}; ${c.newSeeds} buildings with a new facade seed (their look may change)`
}
