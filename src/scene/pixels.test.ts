import { describe, expect, it } from 'vitest'
import { metersPerPixel } from './pixels.ts'

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
