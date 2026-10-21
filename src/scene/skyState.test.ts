import { Color } from 'three'
import { describe, expect, it } from 'vitest'
import { palette } from '../city/palette.ts'
import { sfDateAt } from './sfTime.ts'
import { NIGHT_EXPOSURE, computeSkyState, exposureAt } from './skyState.ts'
import { CLEAR_WEATHER, WEATHER_PRESETS } from './weather.ts'

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

describe('sky state under weather', () => {
  const noon = sfDateAt(12 * 60, DAY)
  const night = sfDateAt(22 * 60, DAY)

  it('leaves clear weather exactly as it was', () => {
    for (const d of [noon, sfDateAt(18 * 60 + 30, DAY), night]) {
      expect(computeSkyState(d, CLEAR_WEATHER)).toEqual(computeSkyState(d))
      expect(computeSkyState(d).fog.density).toBe(0)
      expect(computeSkyState(d).sky.overcast).toBe(0)
    }
  })

  it('under overcast moves the light from the sun to the fill, a little dimmer overall', () => {
    const clear = computeSkyState(noon)
    const overcast = computeSkyState(noon, WEATHER_PRESETS.overcast)
    expect(overcast.light.intensity).toBeLessThan(clear.light.intensity * 0.15)
    expect(overcast.fill.intensity).toBeGreaterThan(clear.fill.intensity * 2)
    // Ground light: sun on flat ground plus the fill, ~20% under clear.
    const ground = (s: typeof clear) =>
      (s.light.intensity * lum(s.light.color) * Math.sin((s.sunElevation * Math.PI) / 180)) / Math.PI + (s.fill.intensity * lum(s.fill.sky)) / Math.PI
    expect(ground(overcast) / ground(clear)).toBeCloseTo(0.8, 1)
    expect(overcast.sky.overcast).toBe(1)
    // Cool, neutral light through cloud, not the clear day's warm bounce.
    expect(overcast.fill.sky.b).toBeGreaterThan(overcast.fill.sky.r)
    expect(overcast.fill.ground.r).toBeLessThanOrEqual(overcast.fill.ground.b)
    // The camera's exposure is unchanged; it's the light that dims.
    expect(overcast.exposure).toBe(clear.exposure)
  })

  it('hides the moon behind overcast, and lights the night clouds gray from the city', () => {
    const s = computeSkyState(night, WEATHER_PRESETS.overcast)
    expect(s.light.isMoon).toBe(true)
    expect(s.light.intensity).toBe(0)
    // Brighter than the clear night sky overhead, and neutral, not brown.
    expect(lum(s.sky.overcastZenith)).toBeGreaterThan(lum(computeSkyState(night).sky.nightZenith) * 3)
    expect(Math.abs(s.sky.overcastZenith.r - s.sky.overcastZenith.b)).toBeLessThan(0.01)
  })

  it('turns low visibility into fog, bright by day and a dim orange-gray glow at night', () => {
    const day = computeSkyState(noon, WEATHER_PRESETS.fog)
    const dark = computeSkyState(night, WEATHER_PRESETS.fog)
    expect(day.fog.density).toBeGreaterThan(0.005)
    expect(day.fog.top).toBeGreaterThan(day.fog.soft)
    expect(day.cloud).toBe(0) // the fog preset is a layer under a clear sky
    expect(lum(day.fog.color)).toBeGreaterThan(0.5)
    // Lit by the city: visible against the dark, warm but still gray, not brown.
    expect(lum(dark.fog.color)).toBeGreaterThan(0.08)
    expect(lum(dark.fog.color)).toBeLessThan(0.2)
    expect(dark.fog.color.r).toBeGreaterThan(dark.fog.color.b)
    expect(dark.fog.color.r - dark.fog.color.b).toBeLessThan(0.05)
    // Lit windows glow through it at night only.
    expect(dark.fog.glow).toBeGreaterThan(0)
    expect(day.fog.glow).toBe(0)
    expect(day.fog.ramp).toBeGreaterThan(0)
  })
})
