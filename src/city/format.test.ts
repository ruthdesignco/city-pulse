import { describe, expect, it } from 'vitest'
import { type CityData, decodeCity, encodeCity } from './format.ts'

function sample(name = 'Salesforce Tower'): CityData {
  return {
    header: {
      version: 1,
      origin: { lat: 37.768, lng: -122.413 },
      ringMeters: 600,
      attribution: '© OpenStreetMap contributors',
      osmTimestamp: '2026-10-18T19:53:20Z',
      bakedAt: '2026-10-18T20:00:00Z',
      landmarks: [{ name, x: 1216, z: -2409, height: 326 }],
    },
    buildings: {
      counts: new Uint16Array([4, 3]),
      heights: new Uint16Array([3260, 85]),
      ringBand: new Uint8Array([0, 37]),
      colorType: new Uint8Array([2, 1]),
      coords: new Int16Array([0, 0, 100, 0, 100, 100, 0, 100, -32000, 32000, -31990, 32000, -32000, 31990]),
    },
    streets: {
      counts: new Uint16Array([2]),
      classes: new Uint8Array([1]),
      coords: new Int16Array([-5, -5, 5, 5]),
    },
    boundary: {
      counts: new Uint16Array([3]),
      coords: new Int16Array([1, 2, 3, 4, 5, 6]),
    },
  }
}

describe('city.bin format', () => {
  it('round-trips every section and the header', () => {
    const data = sample()
    const bytes = encodeCity(data)
    const back = decodeCity(bytes.buffer as ArrayBuffer)
    expect(back.buildings).toEqual(data.buildings)
    expect(back.streets).toEqual(data.streets)
    expect(back.boundary).toEqual(data.boundary)
    expect(back.header.landmarks).toEqual(data.header.landmarks)
    expect(back.header.origin).toEqual(data.header.origin)
  })

  it('aligns every section so typed-array views need no copy', () => {
    const back = decodeCity(encodeCity(sample()).buffer as ArrayBuffer)
    for (const s of Object.values(back.header.sections!)) expect(s.offset % 4).toBe(0)
  })

  it('survives header lengths that shift section alignment', () => {
    // Header growth of 1-3 bytes changes the padding; offsets must follow.
    for (const name of ['A', 'AB', 'ABC', 'ABCD', 'ABCDE']) {
      const back = decodeCity(encodeCity(sample(name)).buffer as ArrayBuffer)
      expect(back.buildings.coords[0]).toBe(0)
      expect(back.boundary.coords[5]).toBe(6)
    }
  })

  it('rejects a file that is not city.bin', () => {
    expect(() => decodeCity(new TextEncoder().encode('<!DOCTYPE html>').buffer as ArrayBuffer)).toThrow(/bad magic/)
  })
})
