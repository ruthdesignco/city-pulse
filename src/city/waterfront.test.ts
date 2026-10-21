import { describe, expect, it } from 'vitest'
import { toScene } from '../geo/projection.ts'
import { COORD_QUANTUM } from './format.ts'
import { distToOutline, waterfrontOutline } from './waterfront.ts'

const at = (lat: number, lng: number) => {
  const { x, z } = toScene(lat, lng)
  return distToOutline(x, z, waterfrontOutline())
}

describe('the waterfront extension', () => {
  it('takes in the Ferry Building, Rincon Hill and South Beach', () => {
    expect(at(37.7955, -122.3937)).toBe(0) // Ferry Building
    expect(at(37.7865, -122.392)).toBe(0) // Rincon Hill
    expect(at(37.7805, -122.3895)).toBe(0) // South Beach, Oracle Park
  })

  it('takes in North Beach and Telegraph Hill up to Bay St', () => {
    expect(at(37.8, -122.41)).toBe(0) // Washington Square, North Beach
    expect(at(37.80246, -122.40593)).toBe(0) // Coit Tower
    expect(at(37.7952, -122.4028)).toBe(0) // Transamerica Pyramid
  })

  it('leaves out Russian Hill, Fisherman\'s Wharf and the open water', () => {
    expect(at(37.801, -122.419)).toBeGreaterThan(0) // Russian Hill
    expect(at(37.808, -122.415)).toBeGreaterThan(0) // north of Bay St
    expect(at(37.79, -122.37)).toBeGreaterThan(0)
  })

  it('stays inside the Int16 coordinate range of city.bin', () => {
    for (const [x, z] of waterfrontOutline()) {
      expect(Math.abs(x)).toBeLessThan(32767 * COORD_QUANTUM)
      expect(Math.abs(z)).toBeLessThan(32767 * COORD_QUANTUM)
    }
  })

  it('is empty-safe: no outline is never inside', () => {
    expect(distToOutline(0, 0, [])).toBe(Infinity)
  })
})
