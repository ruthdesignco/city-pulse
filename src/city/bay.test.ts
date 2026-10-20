import { describe, expect, it } from 'vitest'
import { toScene } from '../geo/projection.ts'
import { bayOutline, inBay } from './bay.ts'

const at = (lat: number, lng: number) => {
  const { x, z } = toScene(lat, lng)
  return inBay(x, z)
}

describe('the Bay', () => {
  it('is water just off the Ferry Building, the Mission Bay piers and the Wharf', () => {
    expect(at(37.7955, -122.389)).toBe(true)
    expect(at(37.772, -122.382)).toBe(true)
    expect(at(37.812, -122.41)).toBe(true)
  })

  it('puts the Ferry Building, tower included, on land at the foot of Market', () => {
    expect(at(37.79547, -122.39356)).toBe(false) // footprint center
    expect(at(37.79614, -122.39432)).toBe(false) // north corner
    expect(at(37.79639, -122.39389)).toBe(false) // northeast corner
    expect(at(37.79493, -122.39254)).toBe(false) // southeast corner
  })

  it('is land in SoMa, the Mission, the Tenderloin and downtown', () => {
    expect(at(37.778, -122.405)).toBe(false) // SoMa
    expect(at(37.76, -122.415)).toBe(false) // Mission
    expect(at(37.784, -122.414)).toBe(false) // Tenderloin
    expect(at(37.79, -122.4)).toBe(false) // Financial District
  })

  it('reaches far past the fog (8 km) to the north and east', () => {
    const xs = bayOutline().map(([x]) => x)
    expect(Math.max(...xs)).toBeGreaterThan(15_000)
  })
})
