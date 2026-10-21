import { describe, expect, it } from 'vitest'
import { MAX_SHIFT_M, MIN_GAP_M, PASS_M, QUEUE_GAP_M, type Pose, Spacing, type Spaced, boxesOverlap, gapFor, spaceQueue } from './spacing.ts'

const L = 12
const W = 2.5

// A vehicle on a straight road through the origin along (hx, hz), its
// estimate `s` meters along it.
function car(id: string, s: number, h: [number, number] = [1, 0], over: Partial<Spaced> = {}): Spaced & { s: number } {
  const v = {
    id,
    s,
    length: L,
    width: W,
    canHold: true,
    underground: false,
    fresh: false,
    advance: 0,
    poseAt(back: number, left = 0): Pose {
      const at = v.s - back
      return { x: h[0] * at + h[1] * left, z: h[1] * at - h[0] * left, hx: h[0], hz: h[1] }
    },
    ...over,
  }
  return v
}

function run(sp: Spacing, cars: Spaced[], seconds: number, move?: () => void) {
  let out = new Map()
  for (let t = 0; t < seconds; t += 0.1) {
    move?.()
    out = sp.update(cars, 0.1)
  }
  return out
}

const drawn = (sp: Spacing, c: Spaced) => c.poseAt(sp.hold(c.id), sp.side(c.id))

describe('spaceQueue', () => {
  it('holds followers back to their spacing', () => {
    expect(spaceQueue([100, 100], [20], 30)).toEqual([0, 20])
    // Already far enough apart: nobody moves.
    expect(spaceQueue([100, 60], [20], 30)).toEqual([0, 0])
  })

  it('moves the whole queue up when a follower would be more than the budget behind', () => {
    // Three at one spot, 25 m apart needed: 0, 25, 50 behind; 20 over budget.
    const s = spaceQueue([0, 0, 0], [25, 25], 30)
    expect(s).toEqual([-20, 5, 30])
  })
})

describe('Spacing', () => {
  it('keeps a moving follower its gap behind the one in front', () => {
    const sp = new Spacing()
    const lead = car('a', 100)
    const follow = car('b', 95, [1, 0], { advance: 0.8 }) // 8 m/s
    run(sp, [lead, follow], 10, () => {
      lead.s += 0.8
      follow.s += 0.8
    })
    const gap = drawn(sp, lead).x - drawn(sp, follow).x - L
    expect(gap).toBeGreaterThan(MIN_GAP_M - 0.5)
    expect(sp.hold('b')).toBeLessThanOrEqual(MAX_SHIFT_M)
  })

  it('lets a stopped queue close up nose to tail', () => {
    expect(gapFor(0)).toBe(QUEUE_GAP_M)
    expect(gapFor(20)).toBe(MIN_GAP_M)
    const sp = new Spacing()
    const cars = [car('a', 50, [1, 0], { fresh: true }), car('b', 50, [1, 0], { fresh: true })]
    run(sp, cars, 1)
    expect(drawn(sp, cars[0]).x - drawn(sp, cars[1]).x).toBeCloseTo(L + QUEUE_GAP_M, 6)
  })

  it('lets the later arrival at a crossing yield until the other is through', () => {
    const sp = new Spacing()
    const east = car('e', -5) // 5 m short of the crossing at the origin
    const south = car('s', -20, [0, 1]) // 20 m short: arrives later
    let worst = 0
    run(sp, [east, south], 6, () => {
      east.s += 0.8
      south.s += 0.8
      east.advance = south.advance = 0.8
      const pe = drawn(sp, east)
      const ps = drawn(sp, south)
      if (boxesOverlap(pe, L, W, ps, L, W)) worst++
    })
    expect(worst).toBe(0)
    expect(sp.hold('e')).toBe(0)
  })

  it('pulls a follower out to pass when the data has it ahead, then back in', () => {
    const sp = new Spacing()
    const slow = car('slow', 100, [1, 0], { advance: 0.1 })
    const fast = car('fast', 80, [1, 0], { advance: 1 })
    let overlaps = 0
    let pulledOut = false
    run(sp, [slow, fast], 20, () => {
      slow.s += 0.1
      fast.s += 1
      if (sp.side('fast') > PASS_M - 0.1) pulledOut = true
      if (boxesOverlap(drawn(sp, slow), L, W, drawn(sp, fast), L, W)) overlaps++
    })
    expect(pulledOut).toBe(true)
    expect(overlaps).toBe(0)
    // Past it now, and back in its lane.
    expect(drawn(sp, fast).x).toBeGreaterThan(drawn(sp, slow).x + L)
    expect(sp.side('fast')).toBe(0)
  })

  it('never draws a vehicle more than 30 m from its estimate', () => {
    const sp = new Spacing()
    const cars = ['a', 'b', 'c', 'd'].map((id) => car(id, 0, [1, 0], { fresh: true }))
    run(sp, cars, 1)
    for (const c of cars) expect(Math.abs(sp.hold(c.id))).toBeLessThanOrEqual(MAX_SHIFT_M)
  })
})
