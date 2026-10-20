import { describe, expect, it } from 'vitest'
import { metersPerPixel } from '../scene/pixels.ts'
import { NEAR_PX, REASSIGN_FRACTION, TYPICAL_CROWN_M, isNear, nearDistance, shouldReassign } from './treeLod.ts'

describe('tree LOD', () => {
  it('switches where a typical crown is NEAR_PX across', () => {
    const d = nearDistance(40, 1080)
    expect(TYPICAL_CROWN_M / metersPerPixel(d, 40, 1080)).toBeCloseTo(NEAR_PX, 6)
    // A bigger viewport keeps detail further out.
    expect(nearDistance(40, 2160)).toBeCloseTo(2 * d, 6)
  })

  it('reassigns on the first frame, a resize, or a move past the threshold only', () => {
    const at = { x: 0, y: 100, z: 0, near: 1000 }
    expect(shouldReassign(null, at)).toBe(true)
    expect(shouldReassign(at, { ...at, near: 900 })).toBe(true)
    expect(shouldReassign(at, { ...at, x: 0.9 * REASSIGN_FRACTION * 1000 })).toBe(false)
    expect(shouldReassign(at, { ...at, x: 1.1 * REASSIGN_FRACTION * 1000 })).toBe(true)
  })

  it('counts the camera height in the distance', () => {
    expect(isNear(0, 600, { x: 0, y: 0, z: 0, near: 1000 })).toBe(true)
    expect(isNear(0, 600, { x: 0, y: 900, z: 0, near: 1000 })).toBe(false)
  })
})
