import { describe, expect, it } from 'vitest'
import { tileKey } from '../../src/city/cityIndex.ts'
import { toScene } from '../../src/geo/projection.ts'
import { loadShippedCity } from './shippedCity.ts'

const shipped = await loadShippedCity()

// The whole city, in tiles (format.ts, cityIndex.ts).
describe('the shipped tiles', () => {
  it('cover all of San Francisco: the Sunset, the Richmond, the Presidio, the south', () => {
    const m = shipped.index.tileM
    const has = (lat: number, lng: number) => {
      const p = toScene(lat, lng)
      return shipped.index.tiles.some((t) => tileKey(t.i, t.j) === tileKey(Math.floor(p.x / m), Math.floor(p.z / m)) && t.buildings > 0)
    }
    expect(has(37.7535, -122.4945)).toBe(true) // the Outer Sunset
    expect(has(37.7795, -122.4875)).toBe(true) // the Outer Richmond
    expect(has(37.7989, -122.4662)).toBe(true) // the Presidio
    expect(has(37.7120, -122.4300)).toBe(true) // the Excelsior
    expect(has(37.7929, -122.4416)).toBe(true) // Pacific Heights
    expect(shipped.city.buildings.counts.length).toBeGreaterThan(150_000)
  })

  it('lists each file at its size on disk', () => {
    for (const t of shipped.index.tiles)
      for (const f of Object.values(t.files)) expect(shipped.fileBytes(f.file), f.file).toBe(f.bytes)
  })

  it("keeps each tile's buildings centered in it", () => {
    const m = shipped.index.tileM
    for (const t of shipped.tiles) {
      let c = 0
      t.buildings.counts.forEach((n) => {
        let sx = 0
        let sz = 0
        for (let i = 0; i < n; i++, c += 2) [sx, sz] = [sx + t.buildings.coords[c], sz + t.buildings.coords[c + 1]]
        // The bake files by the area-weighted centroid; the mean of the
        // corners can sit a little past the edge.
        expect(Math.abs(sx / n - (t.header.i + 0.5) * m)).toBeLessThan(m)
        expect(Math.abs(sz / n - (t.header.j + 0.5) * m)).toBeLessThan(m)
      })
    }
  })
})

// The city seen from afar (farFormat.ts, bake-far.ts).
describe('the shipped far file', async () => {
  const { decodeFar } = await import('../../src/city/farFormat.ts')
  const { readTileFile } = await import('./tileFiles.ts')
  const far = shipped.index.far!
  const data = await decodeFar(readTileFile(far.file))

  it('is listed at its size, with every tile and fewer prisms than buildings', () => {
    expect(shipped.fileBytes(far.file)).toBe(far.bytes)
    expect(data.tiles.map((t) => tileKey(t.i, t.j)).sort()).toEqual(shipped.index.tiles.map((t) => tileKey(t.i, t.j)).sort())
    const prisms = data.tiles.reduce((n, t) => n + t.prisms.counts.length, 0)
    expect(prisms).toBeGreaterThan(10_000)
    expect(prisms).toBeLessThan(shipped.city.buildings.counts.length / 3)
  })

  it('has the woods as canopy, and where every landmark stands', () => {
    expect(data.tiles.reduce((n, t) => n + t.canopy.cells.length, 0)).toBeGreaterThan(5000)
    for (const at of shipped.index.landmarkModels) expect(data.header.landmarkY[at.id], at.id).toBeTypeOf('number')
    // Sutro Tower on Mount Sutro's summit, ~250 m up.
    expect(data.header.landmarkY.sutro).toBeGreaterThan(230)
  })
})

describe('the shipped terrain', () => {
  it("keeps the Bay's islands' ground: Alcatraz and Treasure Island stand out of the water", () => {
    const at = (lat: number, lng: number) => {
      const p = toScene(lat, lng)
      return shipped.heightAt(p.x, p.z)
    }
    expect(at(37.8267, -122.4230)).toBeGreaterThan(20) // Alcatraz
    expect(at(37.8235, -122.3706)).toBeGreaterThan(1) // Treasure Island
  })
})
