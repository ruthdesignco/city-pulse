import { describe, expect, it } from 'vitest'
import { bearingToScene, SUN_AZIMUTH_DEG, SUN_ELEVATION_DEG, SUN_POSITION } from './sun.ts'

describe('bearingToScene', () => {
  it('points north (-z) at bearing 0, elevation 0', () => {
    const [x, y, z] = bearingToScene(0, 0, 1000)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(0, 6)
    expect(z).toBeCloseTo(-1000, 6)
  })

  it('points east (+x) at bearing 90, elevation 0', () => {
    const [x, y, z] = bearingToScene(90, 0, 1000)
    expect(x).toBeCloseTo(1000, 6)
    expect(y).toBeCloseTo(0, 6)
    expect(z).toBeCloseTo(0, 6)
  })

  it('points south (+z) at bearing 180, elevation 0', () => {
    const [x, , z] = bearingToScene(180, 0, 1000)
    expect(x).toBeCloseTo(0, 6)
    expect(z).toBeCloseTo(1000, 6)
  })

  it('points west (-x) at bearing 270, elevation 0', () => {
    const [x, , z] = bearingToScene(270, 0, 1000)
    expect(x).toBeCloseTo(-1000, 6)
    expect(z).toBeCloseTo(0, 6)
  })

  it('points straight up at elevation 90, regardless of bearing', () => {
    const [x, y, z] = bearingToScene(123, 90, 1000)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(1000, 6)
    expect(z).toBeCloseTo(0, 6)
  })

  it('keeps the vector length equal to distance', () => {
    const [x, y, z] = bearingToScene(258, 12, 3400)
    expect(Math.hypot(x, y, z)).toBeCloseTo(3400, 6)
  })
})

describe('SUN_POSITION', () => {
  it('is low and in the WSW quadrant (negative x, small positive y, roughly south-of-west)', () => {
    const [x, y, z] = SUN_POSITION
    expect(x).toBeLessThan(0) // west of center
    expect(y).toBeGreaterThan(0) // above the horizon
    expect(z).toBeGreaterThan(0) // south of due-west, matching a 258deg bearing
    expect(SUN_AZIMUTH_DEG).toBeGreaterThan(180)
    expect(SUN_AZIMUTH_DEG).toBeLessThan(270)
    expect(SUN_ELEVATION_DEG).toBeLessThan(20) // golden hour, not midday
  })
})
