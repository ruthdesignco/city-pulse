import { describe, expect, it } from 'vitest'
import { SKY_INTENSITY, SKY_LIGHT_COLOR, SUN_INTENSITY, SUN_SHARE, sunlitGain } from './lighting.ts'

describe('lighting', () => {
  it('delivers neutral irradiance pi on sunlit ground, so radiance equals albedo per channel', () => {
    const g = sunlitGain()
    expect(g.r).toBeCloseTo(1, 6)
    expect(g.g).toBeCloseTo(1, 6)
    expect(g.b).toBeCloseTo(1, 6)
  })

  it('splits that between sun and sky, both positive', () => {
    expect(SUN_SHARE).toBeGreaterThan(0)
    expect(SUN_SHARE).toBeLessThan(1)
    expect(SUN_INTENSITY).toBeGreaterThan(0)
    expect(SKY_INTENSITY).toBeGreaterThan(0)
  })

  it('solves a cool sky fill against the warm golden-hour sun', () => {
    expect(SKY_LIGHT_COLOR.b).toBeGreaterThan(SKY_LIGHT_COLOR.r)
    for (const c of [SKY_LIGHT_COLOR.r, SKY_LIGHT_COLOR.g, SKY_LIGHT_COLOR.b]) expect(c).toBeGreaterThan(0)
  })
})
