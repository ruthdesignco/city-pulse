import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CityData, encodeCity } from './format.ts'
import { FLAT, encodeTerrain } from './terrain.ts'

// Minimal but valid city.bin bytes, so a successful fetch can actually decode.
const bytes = encodeCity({
  header: {
    version: 2,
    origin: { lat: 37.768, lng: -122.413 },
    ringMeters: 600,
    attribution: '© OpenStreetMap contributors',
    osmTimestamp: null,
    bakedAt: '2026-10-18T20:00:00Z',
    landmarks: [],
  },
  buildings: {
    counts: new Uint16Array(),
    heights: new Uint16Array(),
    ringBand: new Uint8Array(),
    colorIndex: new Uint8Array(),
    seeds: new Uint32Array(),
    coords: new Int16Array(),
  },
  streets: { counts: new Uint16Array(), classes: new Uint8Array(), coords: new Int16Array() },
  boundary: { counts: new Uint16Array(), coords: new Int16Array() },
} satisfies CityData)

const terrainBytes = await encodeTerrain(FLAT)
// city.bin and terrain.bin, by URL (loadCity fetches both).
const ok = (url: string) => ({ ok: true, arrayBuffer: () => Promise.resolve((url.includes('terrain') ? terrainBytes : bytes).buffer) })
const fail = (status: number) => ({ ok: false, status })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules() // loadCity caches its promise at module scope
})

describe('loadCity', () => {
  it('fetches once and shares the promise across calls', async () => {
    const fetchMock = vi.fn((url: string) => Promise.resolve(ok(url)))
    vi.stubGlobal('fetch', fetchMock)
    const { loadCity } = await import('./useCity.ts')

    const [a, b] = await Promise.all([loadCity(), loadCity()])
    expect(a).toBe(b)
    expect(a.terrain.heightAt(0, 0)).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2) // city.bin and terrain.bin, once each
  })

  it('clears the cache on failure, so a retry actually refetches instead of suspending on the dead promise', async () => {
    let failNext = true
    const fetchMock = vi.fn((url: string) => {
      if (failNext && !url.includes('terrain')) {
        failNext = false
        return Promise.resolve(fail(500))
      }
      return Promise.resolve(ok(url))
    })
    vi.stubGlobal('fetch', fetchMock)
    const { loadCity } = await import('./useCity.ts')

    await expect(loadCity()).rejects.toThrow('city.bin: HTTP 500')
    await expect(loadCity()).resolves.toMatchObject({ header: { version: 2 } })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
