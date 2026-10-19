import { describe, expect, it } from 'vitest'
import { MAX_UPSCALE, NEAR_PX, lengthPx, modelScale, turnToward } from './lod.ts'

describe('modelScale', () => {
  it('draws the model at true scale up close', () => {
    expect(modelScale(NEAR_PX)).toBe(1)
    expect(modelScale(400)).toBe(1)
  })

  it('scales up with distance to hold NEAR_PX, never past MAX_UPSCALE', () => {
    expect(modelScale(NEAR_PX / 2)).toBeCloseTo(2)
    expect(modelScale(NEAR_PX / 10)).toBe(MAX_UPSCALE)
    expect(modelScale(0)).toBe(MAX_UPSCALE)
  })

  it('draws a 40 ft bus in the opening view (1.8 km, 40° fov, 1080 px) at the full 3x', () => {
    expect(modelScale(lengthPx(12.2, 1800, 40, 1080))).toBe(MAX_UPSCALE)
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
