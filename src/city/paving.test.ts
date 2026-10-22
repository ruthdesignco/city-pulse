import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import { palette } from './palette.ts'
import { CELL_M, PAVING_SAMPLES, pavingPixels } from './paving.ts'

// A tile at the origin: the city's land west of x = 850 (a soft edge, as
// the masks' bilinear read gives), the ring rising from 0 at x = 0 to 1 at
// x = 1000.
const land = (x: number) => Math.min(1, Math.max(0, (900 - x) / 100))
const px = pavingPixels(0, 0, (x) => land(x), (x) => Math.min(1, Math.max(0, x / 1000)))
const at = (x: number, z: number) => {
  const k = (Math.round(z / CELL_M) * PAVING_SAMPLES + Math.round(x / CELL_M)) * 4
  return Array.from(px.subarray(k, k + 4))
}
const srgb = (hex: string) => new Color(hex).convertLinearToSRGB().toArray().map((v) => Math.round(v * 255))

describe('pavingPixels', () => {
  it('covers the tile edge to edge, its edges shared with the neighbors', () => {
    expect(PAVING_SAMPLES).toBe(1000 / CELL_M + 1)
    expect(px.length).toBe(PAVING_SAMPLES * PAVING_SAMPLES * 4)
  })

  it('is sidewalk concrete inside the neighborhoods, fully paved on the land', () => {
    const [r, g, b, a] = at(0, 500)
    expect([r, g, b]).toEqual(srgb(palette.sidewalk))
    expect(a).toBe(255)
  })

  it('fades in the ring toward the land, not the pale haze', () => {
    const [r, g, b] = at(700, 500)
    const dist = (c: number[], hex: string) => Math.hypot(...c.map((v, i) => v - srgb(hex)[i]))
    expect([r, g, b]).not.toEqual(srgb(palette.sidewalk))
    expect(dist([r, g, b], palette.ground)).toBeLessThan(dist([r, g, b], palette.sky))
  })

  it("is gone off the city's land, with a soft edge", () => {
    expect(at(960, 500)[3]).toBe(0)
    const edge = at(860, 500)[3]
    expect(edge).toBeGreaterThan(0)
    expect(edge).toBeLessThan(255)
  })
})
