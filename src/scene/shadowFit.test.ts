import { describe, expect, it } from 'vitest'
import { SHADOW_MAP_SIZE, fitShadow } from './shadowFit.ts'

const T = [950, 100, -1550] as const

describe('fitShadow', () => {
  it('covers the opening view with ~1.3 m texels, the close-up with ~0.3 m', () => {
    const opening = fitShadow(T, 1800)
    expect(opening.extent).toBeGreaterThanOrEqual(2700)
    expect(opening.texel).toBeLessThan(1.8)
    const close = fitShadow(T, 380)
    expect(close.extent).toBeGreaterThanOrEqual(570)
    expect(close.texel).toBeLessThan(0.45)
    expect(close.texel).toBeCloseTo((2 * close.extent) / SHADOW_MAP_SIZE)
  })

  it('stays clamped at both ends', () => {
    expect(fitShadow(T, 1).extent).toBe(250)
    expect(fitShadow(T, 1e6).extent).toBe(3600)
  })

  it('holds still for small changes, so shadows do not shimmer', () => {
    const a = fitShadow(T, 1800)
    const b = fitShadow([T[0] + 3, T[1], T[2] - 3], 1790)
    expect(b).toEqual(a)
  })

  it('moves in steps as the camera zooms', () => {
    expect(fitShadow(T, 400).extent).toBeLessThan(fitShadow(T, 1200).extent)
  })
})
