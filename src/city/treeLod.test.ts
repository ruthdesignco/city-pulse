import { describe, expect, it } from 'vitest'
import { metersPerPixel } from '../scene/pixels.ts'
import { NEAR_PX, REASSIGN_FRACTION, REASSIGN_TURN_RAD, TYPICAL_CROWN_M, inView, isNear, nearDistance, shouldReassign } from './treeLod.ts'

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

  it('reassigns on a turn past REASSIGN_TURN_RAD', () => {
    const at = { x: 0, y: 100, z: 0, near: 1000, dir: [1, 0, 0] as [number, number, number] }
    const turned = (a: number) => ({ ...at, dir: [Math.cos(a), 0, Math.sin(a)] as [number, number, number] })
    expect(shouldReassign(at, turned(0.9 * REASSIGN_TURN_RAD))).toBe(false)
    expect(shouldReassign(at, turned(1.1 * REASSIGN_TURN_RAD))).toBe(true)
  })

  it('leaves out trees behind the camera, not those around it', () => {
    const cam = { x: 0, y: 30, z: 0, near: 1000, dir: [1, 0, 0] as [number, number, number] }
    expect(inView(500, 0, 100, cam)).toBe(true)
    expect(inView(-500, 0, 0, cam)).toBe(false)
    expect(inView(-20, 0, 0, cam)).toBe(true)
    expect(inView(-500, 0, 0, { ...cam, dir: undefined })).toBe(true)
  })

  it('counts the camera height in the distance', () => {
    expect(isNear(0, 600, { x: 0, y: 0, z: 0, near: 1000 })).toBe(true)
    expect(isNear(0, 600, { x: 0, y: 900, z: 0, near: 1000 })).toBe(false)
  })
})
