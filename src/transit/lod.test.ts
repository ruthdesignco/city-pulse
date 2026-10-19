import { describe, expect, it } from 'vitest'
import { FADE_PX, FAR_PX, MAX_UPSCALE, NEAR_PX, lengthPx, lodFor, turnToward } from './lod.ts'

describe('lodFor', () => {
  it('draws the model at true scale up close', () => {
    expect(lodFor(NEAR_PX)).toEqual({ model: 1, modelScale: 1, marker: 0 })
    expect(lodFor(400)).toEqual({ model: 1, modelScale: 1, marker: 0 })
  })

  it('scales the model up mildly in the mid band, never past MAX_UPSCALE', () => {
    const mid = lodFor((NEAR_PX + FAR_PX) / 2)
    expect(mid.model).toBe(1)
    expect(mid.marker).toBe(0)
    expect(mid.modelScale).toBeGreaterThan(1)
    expect(lodFor(FAR_PX).modelScale).toBeLessThanOrEqual(MAX_UPSCALE)
  })

  it('is only the marker far away', () => {
    expect(lodFor(FADE_PX)).toMatchObject({ model: 0, marker: 1 })
    expect(lodFor(2)).toMatchObject({ model: 0, marker: 1 })
  })

  it('crossfades between the two, weights summing to 1', () => {
    const l = lodFor((FADE_PX + FAR_PX) / 2)
    expect(l.model).toBeGreaterThan(0)
    expect(l.marker).toBeGreaterThan(0)
    expect(l.model + l.marker).toBeCloseTo(1)
  })

  it('puts a 40 ft bus in the opening view (1.8 km, 40° fov, 1080 px) on the marker', () => {
    expect(lodFor(lengthPx(12.2, 1800, 40, 1080)).marker).toBe(1)
  })
})

describe('turnToward', () => {
  it('eases toward the target and gets there', () => {
    const a = turnToward(0, 1, 0.1)
    expect(a).toBeGreaterThan(0)
    expect(a).toBeLessThan(1)
    expect(turnToward(0, 1, 10)).toBeCloseTo(1)
  })

  it('turns the short way across ±π', () => {
    expect(turnToward(3, -3, 0.1)).toBeGreaterThan(3)
    expect(turnToward(-3, 3, 0.1)).toBeLessThan(-3)
  })
})
