import { describe, expect, it } from 'vitest'
import { RING_DIM_MAX, ringDim, ringField, ringPosition } from './ring.ts'

// Two 1 km squares, in scene meters.
const square = (x0: number, z0: number) => [x0, z0, x0 + 1000, z0, x0 + 1000, z0 + 1000, x0, z0 + 1000]
const BOUNDARY = { counts: Uint16Array.from([4, 4]), coords: Float32Array.from([...square(0, 0), ...square(2000, 0)]) }
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
  it('leaves the neighborhoods alone and eases in from the boundary, with no step', () => {
    expect(ringDim(0)).toBe(0)
    expect(ringDim(0.01)).toBeLessThan(0.001)
    expect(ringDim(1)).toBeCloseTo(RING_DIM_MAX)
    expect(ringDim(5)).toBeCloseTo(RING_DIM_MAX)
    expect(ringDim(0.5)).toBeGreaterThan(ringDim(0.1))
    // Smooth: no jump anywhere along the ring.
    for (let r = 0; r < 1; r += 0.01) expect(ringDim(r + 0.01) - ringDim(r)).toBeLessThan(0.006)
  })
})

describe('ringField', () => {
  const field = ringField(BOUNDARY, RING_M, [-1000, -1000, 4000, 2000])
  it('matches ringPosition to within the lattice', () => {
    for (const [x, z] of [[500, 500], [1200, 500], [1700, 500], [500, -400], [3500, 1800], [-900, 1900]])
      expect(Math.abs(field(x, z) - ringPosition(BOUNDARY, RING_M, x, z))).toBeLessThan(0.02)
  })
  it('falls back to the exact value outside its extent, and caches by extent', () => {
    expect(field(500, -5000)).toBe(1)
    expect(ringField(BOUNDARY, RING_M, [-1000, -1000, 4000, 2000])).toBe(field)
  })
})
