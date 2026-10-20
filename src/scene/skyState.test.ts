import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import { palette } from '../city/palette.ts'
import { sfDateAt } from './sfTime.ts'
import { NIGHT_EXPOSURE, computeSkyState, exposureAt } from './skyState.ts'

// 2026-10-20 in San Francisco (PDT): sunrise 07:23, sunset 18:25, civil
// dusk 18:51 (SunCalc 2.1.1, which works in degrees, not 1.x's radians).
const DAY = new Date('2026-10-20T17:00:00Z')
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return computeSkyState(sfDateAt(h * 60 + m, DAY))
}
const lum = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
const compass = (v: { x: number; z: number }) => ((Math.atan2(v.x, -v.z) * 180) / Math.PI + 360) % 360

describe('sky state', () => {
  it('puts the sun where SunCalc says, in degrees and scene axes', () => {
    const noon = at('12:00')
    expect(noon.sunElevation).toBeCloseTo(40.1, 0)
    expect(compass(noon.sunDirection)).toBeCloseTo(162, 0) // SSE
    expect(noon.sunDirection.y).toBeCloseTo(Math.sin((40.1 * Math.PI) / 180), 1)
    expect(at('18:30').sunElevation).toBeLessThan(0) // five minutes after sunset
    expect(compass(at('18:00').sunDirection)).toBeGreaterThan(245) // west-southwest
  })

  it('keeps day exposure at 1, so calibrate means the same at noon and golden hour', () => {
    for (const t of ['10:00', '12:00', '16:50']) expect(at(t).exposure).toBe(1)
    expect(at('22:00').exposure).toBeCloseTo(NIGHT_EXPOSURE, 6)
  })

  it('reproduces the old fixed golden-hour light at ~16 deg', () => {
    const s = at('16:50')
    expect(s.light.isMoon).toBe(false)
    expect(s.light.intensity).toBeGreaterThan(6)
    expect(s.light.intensity).toBeLessThan(7.5)
    const haze = new Color(palette.sky)
    expect(Math.abs(lum(s.haze) - lum(haze))).toBeLessThan(0.06)
  })

  it('hands the light to the moon after sunset, and lights windows from dusk', () => {
    const night = at('22:00')
    expect(night.light.isMoon).toBe(true)
    expect(night.moonElevation).toBeGreaterThan(30)
    expect(night.windowsOn).toBe(1)
    expect(at('12:00').windowsOn).toBe(0)
    expect(at('18:30').windowsOn).toBeGreaterThan(0)
    expect(lum(night.haze)).toBeLessThan(lum(at('12:00').haze) / 4)
  })

  it('moves continuously through sunset: no jumps minute to minute', () => {
    let prev = computeSkyState(sfDateAt(17 * 60 + 30, DAY))
    for (let m = 17 * 60 + 31; m <= 20 * 60; m++) {
      const s = computeSkyState(sfDateAt(m, DAY))
      expect(Math.abs(s.exposure - prev.exposure)).toBeLessThan(0.05)
      expect(Math.abs(lum(s.haze) - lum(prev.haze))).toBeLessThan(0.05)
      expect(Math.abs(s.windowsOn - prev.windowsOn)).toBeLessThan(0.05)
      // The light can switch from sun to moon only while both are ~0.
      if (s.light.isMoon !== prev.light.isMoon) expect(Math.max(s.light.intensity, prev.light.intensity)).toBeLessThan(0.2)
      prev = s
    }
  })

  it('eases exposure monotonically from night to day', () => {
    let last = 0
    for (let e = -20; e <= 20; e += 0.5) {
      expect(exposureAt(e)).toBeGreaterThanOrEqual(last)
      last = exposureAt(e)
    }
  })
})
