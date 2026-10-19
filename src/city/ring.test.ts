import { describe, expect, it } from 'vitest'
import { COORD_QUANTUM } from './format.ts'
import { RING_DIM_MIN, RING_DIM_RANGE, ringDim, ringPosition } from './ring.ts'

// Two 1 km squares, as baked: Int16 coordinates in COORD_QUANTUM units.
const q = (v: number) => Math.round(v / COORD_QUANTUM)
const square = (x0: number, z0: number) => [x0, z0, x0 + 1000, z0, x0 + 1000, z0 + 1000, x0, z0 + 1000].map(q)
const BOUNDARY = { counts: Uint16Array.from([4, 4]), coords: Int16Array.from([...square(0, 0), ...square(2000, 0)]) }
const RING_M = 800

describe('ringPosition', () => {
  it('is 0 inside any of the neighborhoods', () => {
    expect(ringPosition(BOUNDARY, RING_M, 500, 500)).toBe(0)
    expect(ringPosition(BOUNDARY, RING_M, 2500, 500)).toBe(0)
  })

  it('rises with distance to the nearest boundary, capped at 1', () => {
    expect(ringPosition(BOUNDARY, RING_M, 1200, 500)).toBeCloseTo(200 / RING_M) // nearer the first square
    expect(ringPosition(BOUNDARY, RING_M, 1700, 500)).toBeCloseTo(300 / RING_M) // nearer the second
    expect(ringPosition(BOUNDARY, RING_M, 500, -400)).toBeCloseTo(400 / RING_M)
    expect(ringPosition(BOUNDARY, RING_M, 500, -5000)).toBe(1)
  })
})

describe('ringDim', () => {
  it('leaves the neighborhoods alone, steps down at the boundary, and deepens outward', () => {
    expect(ringDim(0)).toBe(0)
    expect(ringDim(0.001)).toBeCloseTo(RING_DIM_MIN, 2)
    expect(ringDim(1)).toBeCloseTo(RING_DIM_MIN + RING_DIM_RANGE)
    expect(ringDim(5)).toBeCloseTo(RING_DIM_MIN + RING_DIM_RANGE)
    expect(ringDim(0.5)).toBeGreaterThan(ringDim(0.1))
  })
})
