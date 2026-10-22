import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import type { CityData } from './format.ts'
import { palette } from './palette.ts'
import { CELL_M, EDGE_BLEND_M, buildPaving, cityEdge } from './paving.ts'

// One 400 m square neighborhood, a 200 m ring, the city's tiles 2 km
// across around it.
const city = {
  header: { ringMeters: 200, extent: [-800, -800, 1200, 1200] },
  boundary: { counts: Uint16Array.of(4), coords: Float32Array.of(0, 0, 400, 0, 400, 400, 0, 400) },
} as unknown as CityData

const near = (a: number[], hex: string) => {
  const c = new Color(hex)
  return Math.abs(a[0] - c.r) < 1e-4 && Math.abs(a[1] - c.g) < 1e-4 && Math.abs(a[2] - c.b) < 1e-4
}

describe('cityEdge', () => {
  const edge = cityEdge(city)
  it('is 0 well inside the city, 1 well past its edge, halfway at it', () => {
    expect(edge(200, 200)).toBe(0)
    expect(edge(1200 - EDGE_BLEND_M / 2, 200)).toBe(0)
    expect(edge(1200, 200)).toBeCloseTo(0.5)
    expect(edge(1200 + EDGE_BLEND_M / 2, 200)).toBe(1)
    expect(edge(-800 - EDGE_BLEND_M, -800 - EDGE_BLEND_M)).toBe(1)
  })
})

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

  it("covers the city's tiles and the blend past their edge, at height y", () => {
    const xs = Array.from({ length: n }, (_, i) => g.position[i * 3])
    expect(Math.min(...xs)).toBeLessThanOrEqual(-800 - EDGE_BLEND_M / 2)
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(1200 + EDGE_BLEND_M / 2 - CELL_M)
    expect(g.position[1]).toBeCloseTo(0.15)
    expect(g.index.length).toBeGreaterThan(0)
  })

  it('is sidewalk concrete inside the neighborhoods', () => {
    expect(near(colorAt(200, 200), palette.sidewalk)).toBe(true)
  })

  it('fades in the ring toward the land, not the pale haze, and stays paved past it', () => {
    const ring = colorAt(-100, 200)
    expect(near(ring, palette.sidewalk)).toBe(false)
    expect(near(ring, palette.ground)).toBe(false)
    const dist = (a: number[], hex: string) => Math.hypot(...a.map((v, i) => v - new Color(hex).toArray()[i]))
    expect(dist(ring, palette.ground)).toBeLessThan(dist(ring, palette.sky))
    // Past the ring, still the city: paved, as the ring's outer edge is.
    expect(near(colorAt(-500, 200), palette.ground)).toBe(false)
  })

  it("becomes bare ground past the city's edge, so it meets the land beyond", () => {
    // The grid's last column, at or past the blend's end.
    const last = Math.max(...Array.from({ length: n }, (_, i) => g.position[i * 3]))
    expect(last).toBeGreaterThanOrEqual(1200 + EDGE_BLEND_M / 2)
    expect(near(colorAt(last, 200), palette.ground)).toBe(true)
  })
})
