import { describe, expect, it } from 'vitest'
import { DASH_GAP_M, DASH_M, LINE_WIDTH_M, type Pt, dashes, emptyMesh, laneLineOffsets, ribbon } from './roads.ts'

const xz = (m: ReturnType<typeof emptyMesh>, i: number): Pt => [m.position[i * 3], m.position[i * 3 + 2]]

describe('ribbon', () => {
  it('spans halfWidth either side of a straight line, two triangles per segment', () => {
    const m = emptyMesh()
    ribbon(m, [[0, 0], [10, 0], [20, 0]], 3, 0.5)
    expect(m.position.length / 3).toBe(6)
    expect(m.index.length).toBe(12)
    for (let i = 0; i < 6; i++) {
      expect(Math.abs(xz(m, i)[1])).toBeCloseTo(3)
      expect(m.position[i * 3 + 1]).toBe(0.5)
    }
  })

  it('keeps its width through a right-angle corner (miter)', () => {
    const m = emptyMesh()
    ribbon(m, [[0, 0], [10, 0], [10, 10]], 2, 0)
    const [lx, lz] = xz(m, 2)
    const [rx, rz] = xz(m, 3)
    // The corner points sit on the diagonal, 2 m from each leg's edge.
    expect(Math.hypot(lx - rx, lz - rz)).toBeCloseTo(2 * 2 * Math.SQRT2)
  })

  it('clamps the miter on a hairpin', () => {
    const m = emptyMesh()
    ribbon(m, [[0, 0], [10, 0], [0, 0.01]], 2, 0)
    const [lx, lz] = xz(m, 2)
    expect(Math.hypot(lx - 10, lz)).toBeLessThanOrEqual(2 * 3 + 1e-6)
  })

  it('skips degenerate lines and duplicate points', () => {
    const m = emptyMesh()
    ribbon(m, [[0, 0]], 2, 0)
    expect(m.position).toHaveLength(0)
    ribbon(m, [[0, 0], [0, 0], [5, 0]], 2, 0)
    expect(m.position.every(Number.isFinite)).toBe(true)
  })
})

describe('dashes', () => {
  it('lays standard skip-line dashes along a line, one quad per dash per offset', () => {
    const m = emptyMesh()
    const length = 120
    dashes(m, [[0, 0], [length, 0]], [-2, 2], 0)
    const per = DASH_M + DASH_GAP_M
    const expected = Math.floor((length - DASH_GAP_M / 2) / per) + 1
    expect(m.index.length / 6).toBe(expected * 2)
    // Each quad is LINE_WIDTH_M wide, centered on its offset.
    expect(Math.abs(xz(m, 0)[1] - xz(m, 1)[1])).toBeCloseTo(LINE_WIDTH_M)
  })

  it('carries the pattern across a joint', () => {
    const a = emptyMesh()
    dashes(a, [[0, 0], [100, 0]], [0], 0)
    const b = emptyMesh()
    dashes(b, [[0, 0], [50, 0], [100, 0]], [0], 0)
    expect(b.index.length).toBeGreaterThanOrEqual(a.index.length)
    expect(b.index.length).toBeLessThanOrEqual(a.index.length + 6)
  })
})

describe('laneLineOffsets', () => {
  it('puts lines between equal lanes', () => {
    expect(laneLineOffsets(18, 4)).toEqual([-4.5, 0, 4.5])
    expect(laneLineOffsets(13, 2)).toEqual([0])
    expect(laneLineOffsets(9, 1)).toEqual([])
  })
})
