import { describe, expect, it } from 'vitest'
import { TunnelIndex, markTunnels } from './tunnels.ts'

const SUBWAY = 4
// A tunnel under x = 100..300 along z = 3 (a few meters off the street's line, z = 0).
const tunnels = new TunnelIndex([[[100, 3], [300, 3]]])

describe('markTunnels', () => {
  it('tags the stretch over a tunnel, with a vertex at each portal', () => {
    const { pts, cls } = markTunnels([[0, 0], [400, 0]], [0, 0], tunnels, SUBWAY)
    const portals = pts.filter((_, i) => i > 0 && cls[i] !== cls[i - 1]).map((p) => p[0])
    expect(portals).toHaveLength(2)
    // Within a step (and the tunnel's reach) of each end.
    expect(portals[0]).toBeGreaterThan(75)
    expect(portals[0]).toBeLessThan(100)
    expect(portals[1]).toBeGreaterThan(300)
    expect(portals[1]).toBeLessThan(325)
    expect(cls[0]).toBe(0)
    expect(cls[cls.length - 1]).toBe(0)
  })

  it('leaves a line crossing the tunnel at right angles on the surface', () => {
    const { cls } = markTunnels([[200, -100], [200, 100]], [1, 1], tunnels, SUBWAY)
    expect(cls.every((c) => c === 1)).toBe(true)
  })
})

describe('markTunnels on broken tunnel data', () => {
  it('bridges a short gap between two tunnel stretches, and ignores a short one', () => {
    const gappy = new TunnelIndex([
      [[0, 0], [300, 0]],
      [[360, 0], [700, 0]], // 60 m gap: a junction
      [[1000, 0], [1030, 0]], // 30 m: an underpass
    ])
    const { pts, cls } = markTunnels([[-100, 0], [1200, 0]], [0, 0], gappy, SUBWAY)
    const under = (x: number) => {
      let i = 0
      while (i + 1 < pts.length && pts[i + 1][0] <= x) i++
      return cls[i] === SUBWAY && (cls[i + 1] ?? SUBWAY) === SUBWAY
    }
    expect(under(330)).toBe(true)
    expect(under(1015)).toBe(false)
    expect(under(800)).toBe(false)
  })
})
