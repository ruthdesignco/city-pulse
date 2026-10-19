import { describe, expect, it } from 'vitest'
import { metersPerPixel, minPixelScale } from './pixels.ts'

describe('metersPerPixel', () => {
  it('matches the frustum height over the viewport height', () => {
    // fov 90: the frustum at distance d is 2d tall.
    expect(metersPerPixel(500, 90, 1000)).toBeCloseTo(1)
    // The opening view: 1.5 km out at fov 40 on a 900 px viewport.
    expect(metersPerPixel(1500, 40, 900)).toBeCloseTo(1.213, 3)
  })

  it('treats a zero-height viewport as one pixel instead of dividing by zero', () => {
    expect(Number.isFinite(metersPerPixel(1000, 40, 0))).toBe(true)
  })
})

describe('minPixelScale', () => {
  it('leaves an object alone while it is already big enough', () => {
    // A 10 m bus at 1.5 km is ~8 px wide.
    expect(minPixelScale(10, 4, 1500, 40, 900)).toBe(1)
  })

  it('grows a far object to exactly the minimum size', () => {
    const scale = minPixelScale(10, 4, 6500, 40, 900)
    expect(scale).toBeGreaterThan(1)
    expect((10 * scale) / metersPerPixel(6500, 40, 900)).toBeCloseTo(4)
  })
})
