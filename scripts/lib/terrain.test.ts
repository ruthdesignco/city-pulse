import { describe, expect, it } from 'vitest'
import { toScene } from '../../src/geo/projection.ts'
import { loadShippedCity } from './shippedCity.ts'

const shipped = await loadShippedCity()
const at = (lat: number, lng: number) => {
  const p = toScene(lat, lng)
  return shipped.heightAt(p.x, p.z)
}

// The shipped terrain against known elevations (NAVD88; OSM's ele tags and
// USGS GNIS where they exist, else the city's own figures, all rounded).
describe('the shipped terrain', () => {
  it('puts Telegraph Hill under Coit Tower at ~89 m (OSM ele=89)', () => {
    expect(at(37.80246, -122.40593)).toBeGreaterThan(80)
    expect(at(37.80246, -122.40593)).toBeLessThan(95)
  })

  it('climbs California Street to Nob Hill, ~90 m, from ~15 m at Kearny', () => {
    expect(at(37.79288, -122.40476)).toBeLessThan(25) // Kearny
    expect(at(37.79184, -122.4108)).toBeGreaterThan(80) // Mason
  })

  it('keeps the flats near sea level and the Bay under the water', () => {
    expect(at(37.7955, -122.3937)).toBeLessThan(8) // Ferry Building
    expect(at(37.775, -122.418)).toBeLessThan(25) // Market and Van Ness
    expect(at(37.792, -122.385)).toBeLessThan(0.2) // the Bay, off Rincon Point
  })

  it('reaches across the city: Twin Peaks at ~280 m, Ocean Beach at the sea', () => {
    expect(at(37.7516, -122.4477)).toBeGreaterThan(270) // Twin Peaks' south summit, 282 m
    expect(at(37.7516, -122.4477)).toBeLessThan(290)
    expect(at(37.76, -122.5115)).toBeLessThan(12) // the Great Highway at Ocean Beach
  })

  it('has ground under every tile, its edges shared with its neighbors', () => {
    expect(shipped.terrain.size).toBe(shipped.index.tiles.length)
    const m = shipped.index.tileM
    for (const [k, t] of shipped.terrain) {
      const [i, j] = k.split(',').map(Number)
      const east = shipped.terrain.get(`${i + 1},${j}`)
      if (east) for (let z = j * m; z <= (j + 1) * m; z += 50) expect(east.heightAt((i + 1) * m, z)).toBeCloseTo(t.heightAt((i + 1) * m, z), 6)
    }
  })
})
