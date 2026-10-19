import { describe, expect, it } from 'vitest'
import { type Pt, inBakeArea as bakeInBakeArea } from '../../../scripts/lib/geometry.ts'
import { toScene } from '../../../src/geo/projection.ts'
import { inBakeArea, toAreaMeters } from './area.ts'
import bakeArea from './bake-area.json' with { type: 'json' }

const rings: Pt[][] = bakeArea.rings.map((r) => {
  const pts: Pt[] = []
  for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]])
  return pts
})

// Deterministic pseudo-random points (mulberry32) so failures reproduce.
function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('bake area clip', () => {
  it('projects exactly like src/geo/projection.ts', () => {
    for (const [lat, lng] of [
      [37.768, -122.413],
      [37.79, -122.39],
      [37.74, -122.44],
    ]) {
      const [x, z] = toAreaMeters(lat, lng)
      const s = toScene(lat, lng)
      expect(x).toBeCloseTo(s.x, 9)
      expect(z).toBeCloseTo(s.z, 9)
    }
  })

  it('agrees with the bake predicate on 2000 points around the area', () => {
    const rand = rng(511)
    let inside = 0
    for (let i = 0; i < 2000; i++) {
      const lat = 37.72 + rand() * 0.1
      const lng = -122.46 + rand() * 0.1
      const s = toScene(lat, lng)
      const expected = bakeInBakeArea([s.x, s.z], rings, bakeArea.ringMeters)
      expect(inBakeArea(lat, lng), `${lat},${lng}`).toBe(expected)
      if (expected) inside++
    }
    expect(inside).toBeGreaterThan(200) // the sample really straddles the edge
    expect(inside).toBeLessThan(1800)
  })

  it.each([
    ['Civic Center (Tenderloin)', 37.7793, -122.4193, true],
    ['16th St Mission BART', 37.765, -122.4195, true],
    ['4th & King (SoMa)', 37.7766, -122.3947, true],
    ['Golden Gate Park', 37.7694, -122.4862, false],
    ['Ocean Beach', 37.7594, -122.5107, false],
    ['Oakland', 37.8044, -122.2712, false],
  ])('%s -> %s', (_name, lat, lng, expected) => {
    expect(inBakeArea(lat, lng)).toBe(expected)
  })

  it('rejects non-finite coordinates', () => {
    expect(inBakeArea(NaN, -122.41)).toBe(false)
    expect(inBakeArea(37.77, Infinity)).toBe(false)
  })
})
