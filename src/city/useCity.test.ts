import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CityIndex } from './cityIndex.ts'
import { encodeLandCover } from './landCover.ts'
import { Terrain, encodeTerrain } from './terrain.ts'

const flat = (x0: number, z0: number, cell: number, n: number, h: number) =>
  new Terrain({ version: 2, x0, z0, cell, nx: n, nz: n, quantum: 0.1, source: 'test', datum: '', bakedAt: '' }, new Int16Array(n * n).fill(h * 10))
const index: CityIndex = {
  version: 1,
  origin: { lat: 37.768, lng: -122.413 },
  tileM: 1000,
  ringMeters: 800,
  boundary: [[0, 0, 100, 0, 100, 100]],
  waterfront: [],
  landmarks: [],
  landmarkModels: [],
  attribution: '© OpenStreetMap contributors',
  osmTimestamp: null,
  osmElementsSha256: '',
  bakedAt: '2026-10-21T00:00:00Z',
  sources: {},
  tiles: [{ i: 0, j: 0, buildings: 0, land: 1, files: { city: { file: 'city-0_0-a.bin', bytes: 10 } } }],
}
const files: Record<string, Uint8Array> = {
  landcover: await encodeLandCover({
    header: { version: 1, x0: 0, z0: 0, cell: 50, nx: 1, nz: 1, buildings: [], source: 'test', bakedAt: '' },
    rgba: new Uint8Array(4),
  }),
  // The backdrop: 20 m everywhere.
  backdrop: await encodeTerrain(flat(-5000, -5000, 50, 201, 20)),
  index: new TextEncoder().encode(JSON.stringify(index)),
}
const bytesFor = (url: string) => {
  for (const k of ['landcover', 'backdrop', 'index']) if (url.includes(k)) return files[k]
  throw new Error(`no fixture for ${url}`)
}
const ok = (url: string) => ({ ok: true, arrayBuffer: () => Promise.resolve(bytesFor(url).slice().buffer) })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules() // loadCityBase caches its promise at module scope
})

describe('loadCityBase', () => {
  it('fetches the index, the backdrop and the land cover once, sharing the promise; no tiles', async () => {
    const fetchMock = vi.fn((url: string) => Promise.resolve(ok(url)))
    vi.stubGlobal('fetch', fetchMock)
    const { loadCityBase } = await import('./useCity.ts')
    const [a, b] = await Promise.all([loadCityBase(), loadCityBase()])
    expect(a).toBe(b)
    expect(a.index.tiles).toHaveLength(1)
    expect(a.boundary.counts).toEqual(Uint16Array.of(3))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('clears the cache on failure, so a retry actually refetches instead of suspending on the dead promise', async () => {
    let failNext = true
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (failNext && url.includes('backdrop')) {
          failNext = false
          return Promise.resolve({ ok: false, status: 500 })
        }
        return Promise.resolve(ok(url))
      }),
    )
    const { loadCityBase } = await import('./useCity.ts')
    await expect(loadCityBase()).rejects.toThrow('backdrop.bin: HTTP 500')
    await expect(loadCityBase()).resolves.toMatchObject({ index: { ringMeters: 800 } })
  })
})

describe('cityGround', () => {
  it("is the backdrop's ground until a tile's terrain arrives, then the tile's", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => Promise.resolve(ok(url))),
    )
    const { LAND_Y, cityGround, loadCityBase } = await import('./useCity.ts')
    await loadCityBase()
    expect(cityGround.heightAt(500, 500)).toBeCloseTo(20 + LAND_Y)
    const waiting = cityGround.whenTiles(['0,0'])
    const t = flat(0, 0, 5, 201, 12)
    cityGround.setTile('0,0', t.header, t.heights)
    await waiting
    expect(cityGround.heightAt(500, 500)).toBeCloseTo(12)
    expect(cityGround.heightAt(1500, 500)).toBeCloseTo(20 + LAND_Y) // a tile not in
  })
})
