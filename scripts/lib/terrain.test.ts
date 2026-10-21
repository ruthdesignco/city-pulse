import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeCity } from '../../src/city/format.ts'
import { decodeTerrain } from '../../src/city/terrain.ts'
import { toScene } from '../../src/geo/projection.ts'

const read = (f: string) => {
  const b = readFileSync(join(import.meta.dirname, '../../src/data', f))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
const terrain = decodeTerrain(read('terrain.bin'))
const city = decodeCity(read('city.bin'))
const at = (lat: number, lng: number) => {
  const p = toScene(lat, lng)
  return terrain.heightAt(p.x, p.z)
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
    expect(at(37.79, -122.37)).toBeLessThan(0.2) // the Bay
  })

  it('covers the whole bake area', () => {
    const [minX, minZ, maxX, maxZ] = city.header.extent!
    const { x0, z0, cell, nx, nz } = terrain.header
    expect(x0).toBeLessThanOrEqual(minX)
    expect(z0).toBeLessThanOrEqual(minZ)
    expect(x0 + (nx - 1) * cell).toBeGreaterThanOrEqual(maxX)
    expect(z0 + (nz - 1) * cell).toBeGreaterThanOrEqual(maxZ)
  })
})
