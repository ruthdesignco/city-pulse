import { describe, expect, it } from 'vitest'
import { FAR_LOT_M, FAR_LOT_PX, HYSTERESIS, NEAR_FLOOR_M, NEAR_FLOOR_PX, levelFor, pxPerMeter, thresholds, tileDistance } from './lod.ts'

describe('tile levels of detail', () => {
  it('puts the lines where a floor, then a lot, shrinks under its pixels', () => {
    const t = thresholds(40, 1500)
    const k = pxPerMeter(40, 1500)
    expect((NEAR_FLOOR_M * k) / t.near).toBeCloseTo(NEAR_FLOOR_PX)
    expect((FAR_LOT_M * k) / t.far).toBeCloseTo(FAR_LOT_PX)
    // At Retina size (1500 px tall at the 1.5 pixel cap): ~3.6 km and ~8 km.
    expect(t.near).toBeGreaterThan(3000)
    expect(t.far).toBeGreaterThan(t.near * 2)
    // Fewer pixels, nearer lines.
    expect(thresholds(40, 1000).near).toBeLessThan(t.near)
  })

  it('picks near, mid and far by distance', () => {
    const t = { near: 1000, far: 3000 }
    expect(levelFor(500, null, t)).toBe('near')
    expect(levelFor(2000, null, t)).toBe('mid')
    expect(levelFor(5000, null, t)).toBe('far')
  })

  it('holds a level until HYSTERESIS past its line', () => {
    const t = { near: 1000, far: 3000 }
    const inside = 1 - HYSTERESIS / 2
    const outside = 1 + HYSTERESIS / 2
    expect(levelFor(1000 * outside, 'near', t)).toBe('near')
    expect(levelFor(1000 * inside, 'mid', t)).toBe('mid')
    expect(levelFor(1000 * (1 + 2 * HYSTERESIS), 'near', t)).toBe('mid')
    expect(levelFor(3000 * inside, 'far', t)).toBe('far')
    expect(levelFor(3000 * outside, 'mid', t)).toBe('mid')
  })

  it("measures to a tile's nearest point, the camera's height included", () => {
    expect(tileDistance({ x: 500, y: 300, z: 500 }, 0, 0, 1000)).toBe(300)
    expect(tileDistance({ x: -400, y: 300, z: 500 }, 0, 0, 1000)).toBeCloseTo(500)
    expect(tileDistance({ x: 1300, y: 0, z: 1400 }, 0, 0, 1000)).toBeCloseTo(500)
  })
})
