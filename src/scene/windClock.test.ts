import { describe, expect, it } from 'vitest'
import { sceneUniforms } from './sceneUniforms.ts'
import { WIND_PRESETS } from './wind.ts'
import { setWind, tickWind } from './windClock.ts'

describe('wind clock', () => {
  it('starts at the first wind, then eases to the next over about 10 s', () => {
    setWind(WIND_PRESETS.calm)
    expect(sceneUniforms.uWind.value).toBe(0)
    setWind(WIND_PRESETS.strong)
    tickWind(1 / 60)
    expect(sceneUniforms.uWind.value).toBeGreaterThan(0)
    expect(sceneUniforms.uWind.value).toBeLessThan(0.05)
    for (let i = 0; i < 60 * 11; i++) tickWind(1 / 60)
    expect(sceneUniforms.uWind.value).toBeGreaterThan(0.95)
    expect(sceneUniforms.uWindDir.value.length()).toBeCloseTo(1, 6)
  })

  it('advances the sway clock steadily, faster in a strong wind', () => {
    const before = sceneUniforms.uWindClock.value
    tickWind(1)
    expect(sceneUniforms.uWindClock.value - before).toBeGreaterThan(2)
  })
})
