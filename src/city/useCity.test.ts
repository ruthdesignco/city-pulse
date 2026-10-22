import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CityIndex } from './cityIndex.ts'
import { encodeTile, toLines } from './format.ts'
import { encodeLandCover } from './landCover.ts'
import { Terrain, encodeTerrain } from './terrain.ts'

// One tile at the origin (inside LOAD_EXTENT), and one far outside it.
const tile = (i: number, j: number) =>
  encodeTile({
    header: { version: 1, i, j, x0: i * 1000, z0: j * 1000, pinnedMaterials: [] },
    buildings: { ...toLines([]), heights: new Uint16Array(), ringBand: new Uint8Array(), colorIndex: new Uint8Array(), seeds: new Uint32Array() },
    streets: { ...toLines([]), classes: new Uint8Array() },
    cover: { ...toLines([]), classes: new Uint8Array() },
  })
const ground = (i: number, j: number, h: number) =>
  encodeTerrain(
    new Terrain(
      { version: 2, x0: i * 1000, z0: j * 1000, cell: 5, nx: 201, nz: 201, quantum: 0.1, source: 'test', datum: '', bakedAt: '' },
      new Int16Array(201 * 201).fill(h * 10),
    ),
  )
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
  tiles: [
    { i: 0, j: 0, buildings: 0, land: 1, files: { city: { file: 'city-0_0-a.bin', bytes: 10 }, terrain: { file: 'terrain-0_0-a.bin', bytes: 20 } } },
    { i: -9, j: 0, buildings: 0, land: 1, files: { city: { file: 'city--9_0-a.bin', bytes: 10 }, terrain: { file: 'terrain--9_0-a.bin', bytes: 20 } } },
  ],
}
const files: Record<string, Uint8Array> = {
  'city-0_0-a.bin': await tile(0, 0),
  'city--9_0-a.bin': await tile(-9, 0),
  'terrain-0_0-a.bin': await ground(0, 0, 12),
  'terrain--9_0-a.bin': await ground(-9, 0, 30),
  landcover: await encodeLandCover({
    header: { version: 1, x0: 0, z0: 0, cell: 50, nx: 1, nz: 1, buildings: [], source: 'test', bakedAt: '' },
    rgba: new Uint8Array(4),
  }),
  backdrop: await ground(0, 0, 0),
  index: new TextEncoder().encode(JSON.stringify(index)),
}
const bytesFor = (url: string) => {
  const name = url.split('/').pop() ?? ''
  if (files[name]) return files[name]
  for (const k of ['landcover', 'backdrop', 'index']) if (url.includes(k)) return files[k]
  throw new Error(`no fixture for ${url}`)
}
const ok = (url: string) => ({ ok: true, arrayBuffer: () => Promise.resolve(bytesFor(url).slice().buffer) })
const fail = (status: number) => ({ ok: false, status })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules() // loadCity caches its promise at module scope
})

describe('loadCity', () => {
  it("fetches the index, then the tiles over the load extent, once, sharing the promise", async () => {
    const fetchMock = vi.fn((url: string) => Promise.resolve(ok(url)))
    vi.stubGlobal('fetch', fetchMock)
    const { loadCity } = await import('./useCity.ts')

    const [a, b] = await Promise.all([loadCity(), loadCity()])
    expect(a).toBe(b)
    expect(a.tiles.map((t) => [t.header.i, t.header.j])).toEqual([[0, 0]]) // not the far one
    expect(a.terrain.heightAt(500, 500)).toBeCloseTo(12)
    expect(a.bytes).toEqual({ city: 10, terrain: 20 })
    // The index, the tile's two files, the backdrop and the land cover.
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('clears the cache on failure, so a retry actually refetches instead of suspending on the dead promise', async () => {
    let failNext = true
    const fetchMock = vi.fn((url: string) => {
      if (failNext && url.includes('city-0_0')) {
        failNext = false
        return Promise.resolve(fail(500))
      }
      return Promise.resolve(ok(url))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { loadCity } = await import('./useCity.ts')

    await expect(loadCity()).rejects.toThrow('city-0_0-a.bin: HTTP 500')
    await expect(loadCity()).resolves.toMatchObject({ header: { ringMeters: 800 } })
  })
})
