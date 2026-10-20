import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import type { CityData } from './format.ts'
import { palette } from './palette.ts'
import { CELL_M, EDGE_BLEND_M, buildPaving } from './paving.ts'
import { ringDim } from './ring.ts'

// One 400 m square neighborhood (coords in 0.1 m units), a 200 m ring.
const city = {
  header: { ringMeters: 200 },
  boundary: { counts: Uint16Array.of(4), coords: Int16Array.of(0, 0, 4000, 0, 4000, 4000, 0, 4000) },
} as unknown as CityData

const near = (a: number[], hex: string) => {
  const c = new Color(hex)
  return Math.abs(a[0] - c.r) < 1e-4 && Math.abs(a[1] - c.g) < 1e-4 && Math.abs(a[2] - c.b) < 1e-4
}

describe('buildPaving', () => {
  const g = buildPaving(city, 0.15)
  const n = g.position.length / 3
  const colorAt = (x: number, z: number) => {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(g.position[i * 3] - x, g.position[i * 3 + 2] - z)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    return Array.from(g.color.slice(best * 3, best * 3 + 3))
  }

  it('covers the neighborhoods, the ring and the edge blend, at height y', () => {
    const xs = Array.from({ length: n }, (_, i) => g.position[i * 3])
    expect(Math.min(...xs)).toBeLessThanOrEqual(-(200 + EDGE_BLEND_M))
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(400 + 200 + EDGE_BLEND_M - CELL_M)
    expect(g.position[1]).toBeCloseTo(0.15)
    expect(g.index.length).toBeGreaterThan(0)
  })

  it('is sidewalk concrete inside the neighborhoods', () => {
    expect(near(colorAt(200, 200), palette.sidewalk)).toBe(true)
  })

  it('fades toward the sky in the ring, like the sidewalks there', () => {
    const ring = colorAt(-100, 200)
    expect(near(ring, palette.sidewalk)).toBe(false)
    expect(near(ring, palette.ground)).toBe(false)
  })

  it('becomes bare ground past the ring, so it meets the ground plane seamlessly', () => {
    expect(near(colorAt(-(200 + EDGE_BLEND_M + 10), 200), palette.ground)).toBe(true)
  })

  it('reaches out over a waterfront extension as ring paving, then blends into ground past it', () => {
    // A 400 m wide strip running 1.5 km east of the ring's edge.
    const wide = { ...city, header: { ringMeters: 200, waterfront: [[400, 0], [2000, 0], [2000, 400], [400, 400]] } } as unknown as CityData
    const w = buildPaving(wide, 0.15)
    const m = w.position.length / 3
    const at = (x: number, z: number) => {
      let best = 0
      for (let i = 1; i < m; i++)
        if (Math.hypot(w.position[i * 3] - x, w.position[i * 3 + 2] - z) < Math.hypot(w.position[best * 3] - x, w.position[best * 3 + 2] - z)) best = i
      return Array.from(w.color.slice(best * 3, best * 3 + 3))
    }
    const edge = new Color(palette.sidewalk).lerp(new Color(palette.sky), ringDim(1))
    at(1800, 200).forEach((v, i) => expect(v).toBeCloseTo(edge.toArray()[i], 4))
    expect(near(at(2000 + EDGE_BLEND_M + 10, 200), palette.ground)).toBe(true)
  })
})
