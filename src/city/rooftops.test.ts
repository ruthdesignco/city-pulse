import { describe, expect, it } from 'vitest'
import { EDGE_M, MIN_ROOF_M2, RoofItem, cornersOf, generateRooftops, insideRing } from './rooftops.ts'

// Footprints in meters: a 40 x 30 m commercial block (Neutral, 20 m),
// a 120 m tower 30 x 30 m (Tower), a 6 x 6 m kiosk, and a 30 x 20 m
// residential building only 5 m tall.
const rect = (x: number, z: number, w: number, d: number) => [x, z, x + w, z, x + w, z + d, x, z + d]
const buildings = {
  counts: Uint16Array.from([4, 4, 4, 4]),
  heights: Uint16Array.from([200, 1200, 100, 50]),
  ringBand: Uint8Array.from([0, 0, 0, 0]),
  colorIndex: Uint8Array.from([0, 6, 0, 3]),
  seeds: Uint32Array.from([11, 22, 33, 44]),
  coords: Float32Array.from([...rect(0, 0, 40, 30), ...rect(100, 0, 30, 30), ...rect(200, 0, 6, 6), ...rect(300, 0, 30, 20)]),
}
const rings = [rect(0, 0, 40, 30), rect(100, 0, 30, 30), rect(200, 0, 6, 6), rect(300, 0, 30, 20)]

describe('generateRooftops', () => {
  const pieces = generateRooftops(buildings, 800)

  it('is deterministic per building', () => {
    expect(generateRooftops(buildings, 800)).toEqual(pieces)
  })

  it('stands every item on its roof, inside the edge margin', () => {
    expect(pieces.length).toBeGreaterThan(0)
    for (const p of pieces) {
      expect(p.y).toBeCloseTo(buildings.heights[p.building] / 10, 6)
      for (const [x, z] of cornersOf(p, EDGE_M - 0.01)) expect(insideRing(rings[p.building], x, z)).toBe(true)
    }
  })

  it('gives a tower a big mechanical penthouse, and small or low buildings nothing', () => {
    const tower = pieces.filter((p) => p.building === 1)
    const penthouse = tower.find((p) => p.kind === RoofItem.Penthouse)
    expect(penthouse).toBeDefined()
    expect(penthouse!.w).toBeGreaterThanOrEqual(7)
    expect(36).toBeLessThan(MIN_ROOF_M2) // the kiosk's roof
    expect(pieces.some((p) => p.building === 2 || p.building === 3)).toBe(false)
  })

  it('skips the buildings it is told to (pinned landmarks)', () => {
    expect(generateRooftops(buildings, 800, new Set([1])).some((p) => p.building === 1)).toBe(false)
  })

  it("doesn't overlap items on a roof", () => {
    for (let i = 0; i < pieces.length; i++)
      for (let j = i + 1; j < pieces.length; j++) {
        const a = pieces[i]
        const b = pieces[j]
        if (a.building !== b.building) continue
        expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan((Math.hypot(a.w, a.d) + Math.hypot(b.w, b.d)) / 2)
      }
  })
})
