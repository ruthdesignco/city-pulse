import { describe, expect, it } from 'vitest'
import type { Pt } from './geometry.ts'
import { OFF_STREET, StreetIndex, TURN_RADIUS_M, snapRoute } from './snapRoute.ts'

// Two streets crossing at the origin: one east-west (Major, class 0), one
// north-south (Local, class 2).
const index = new StreetIndex([
  { line: [[-300, 0], [300, 0]], cls: 0 },
  { line: [[0, -300], [0, 300]], cls: 2 },
])
const maxOff = (pts: Pt[], f: (p: Pt) => number) => Math.max(...pts.map(f))

describe('snapRoute', () => {
  it('moves a shape traced a few meters off a street onto its centerline', () => {
    const { pts, cls } = snapRoute([[-200, 6], [-50, 5]], index)
    expect(maxOff(pts, (p) => Math.abs(p[1]))).toBeLessThan(1e-6)
    expect(cls.every((c) => c === 0)).toBe(true)
  })

  it('turns from one street onto the other at their intersection, on a rounded corner', () => {
    // GTFS cuts the corner 7 m inside it and runs a few meters off both streets.
    const { pts, cls } = snapRoute([[-200, 4], [-7, 4], [-4, 7], [-4, 200]], index)
    // Every point on one of the streets or on the corner's arc.
    for (const [x, z] of pts) expect(Math.min(Math.abs(z), Math.abs(x)) < 1e-6 || Math.hypot(x + TURN_RADIUS_M, z - TURN_RADIUS_M) - TURN_RADIUS_M < 0.05).toBe(true)
    // The arc reaches within r (1 - 1/sqrt 2) of the corner, not through it.
    const nearest = Math.min(...pts.map(([x, z]) => Math.hypot(x, z)))
    expect(nearest).toBeGreaterThan(TURN_RADIUS_M * 0.9 * (Math.SQRT2 - 1))
    expect(nearest).toBeLessThan(TURN_RADIUS_M * 1.1 * (Math.SQRT2 - 1))
    expect(cls[0]).toBe(0)
    expect(cls[cls.length - 1]).toBe(2)
  })

  it('leaves a shape alone where no street runs its way', () => {
    // Diagonal, crossing both streets: aligned with neither.
    const line: Pt[] = [[-100, -100], [100, 100]]
    const { pts, cls } = snapRoute(line, index)
    expect(pts[0]).toEqual(line[0])
    expect(pts[pts.length - 1]).toEqual(line[1])
    expect(cls.every((c) => c === OFF_STREET)).toBe(true)
  })

  it("doesn't pull a shape onto a street farther than 15 m away", () => {
    const { cls } = snapRoute([[-200, 30], [-50, 30]], index)
    expect(cls.every((c) => c === OFF_STREET)).toBe(true)
  })
})

describe('snapRoute on overlapping ways', () => {
  it('never doubles back where one way hands over to the next', () => {
    // One street drawn as two ways that overlap by 10 m, 1 m apart.
    const twoWays = new StreetIndex([
      { line: [[-300, 0], [5, 0]], cls: 1 },
      { line: [[-5, 1], [300, 1]], cls: 1 },
    ])
    const { pts } = snapRoute([[-200, 3], [200, 3]], twoWays)
    for (let i = 1; i < pts.length; i++) expect(pts[i][0]).toBeGreaterThan(pts[i - 1][0])
  })
})
