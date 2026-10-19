import { describe, expect, it } from 'vitest'
import {
  CATCHUP_SPEED,
  type Fix,
  type Motion,
  RESNAP_M,
  STALE_MS,
  type VehicleReport,
  applyReport,
  choosePlan,
  coast,
  createMotion,
  isStale,
  step,
  targetS,
} from './motion.ts'
import { makeLine } from './shapes.ts'

const T0 = 1_792_368_000_000 // ms
const s = (sec: number) => T0 + sec * 1000

// 3 km east along z = 0, and the same street westbound.
const EAST = makeLine('east#0', 'R', 0, [0, 0, 3000, 0])
const WEST = makeLine('west#0', 'R', 1, [3000, 0, 0, 0])

const fix = (sec: number, x: number, z = 0): Fix => ({ t: s(sec), x, z })
const report = (latest: Fix, previous: Fix | null, over: Partial<VehicleReport> = {}): VehicleReport => ({
  id: 'bus',
  routeId: 'R',
  directionId: 0,
  latest,
  previous,
  ...over,
})

// Step at 60 fps from `from` to `to` (seconds), returning s after each frame.
function run(m: Motion, from: number, to: number, onFrame?: (m: Motion, dt: number) => void): number[] {
  const out: number[] = []
  const dt = 1 / 60
  for (let t = from; t < to; t += dt) {
    step(m, s(t + dt), dt)
    onFrame?.(m, dt)
    out.push(m.s)
  }
  return out
}

const nonDecreasing = (xs: number[]) => xs.every((v, i) => i === 0 || v >= xs[i - 1] - 1e-9)

describe('coast', () => {
  it('is linear for 45 s, then eases to at most 75 s of travel', () => {
    expect(coast(-5)).toBe(0)
    expect(coast(30)).toBe(30)
    expect(coast(45)).toBe(45)
    expect(coast(75)).toBeCloseTo(45 + 30 * (1 - Math.exp(-1)), 9)
    expect(coast(10_000)).toBeCloseTo(75, 6)
  })
})

describe('choosePlan', () => {
  it('measures speed along the shape between the two observations', () => {
    const p = choosePlan(report(fix(75, 600, 3), fix(0, 300, -2)), [EAST], null)
    expect(p.line).toBe(EAST)
    expect(p.sB).toBeCloseTo(600, 6)
    expect(p.v).toBeCloseTo(4, 6) // 300 m in 75 s
  })

  it('missing previous point: sits at B with no speed', () => {
    const p = choosePlan(report(fix(0, 500), null), [EAST], null)
    expect(p).toMatchObject({ line: EAST, v: 0 })
    expect(p.sB).toBeCloseTo(500, 6)
  })

  it('off route: more than 40 m from every shape', () => {
    const p = choosePlan(report(fix(75, 600, 60), fix(0, 300)), [EAST], null)
    expect(p).toMatchObject({ line: null, v: 0, x: 600, z: 60 })
  })

  it('unknown route: no shapes at all', () => {
    expect(choosePlan(report(fix(0, 1, 2), null, { routeId: 'nope' }), undefined, null)).toMatchObject({ line: null, x: 1, z: 2 })
  })

  it('backward movement along the shape gives zero speed, not negative', () => {
    // Direction unknown, only the eastbound shape: the bus appears to reverse.
    const p = choosePlan(report(fix(75, 300), fix(0, 600), { directionId: null }), [EAST], null)
    expect(p.v).toBe(0)
  })

  it('no speed from a zero, negative, or over-5-minute gap', () => {
    expect(choosePlan(report(fix(0, 600), fix(0, 300)), [EAST], null).v).toBe(0)
    expect(choosePlan(report(fix(0, 600), fix(10, 300)), [EAST], null).v).toBe(0)
    expect(choosePlan(report(fix(400, 900), fix(0, 300)), [EAST], null).v).toBe(0)
  })

  it('caps inferred speed at 20 m/s', () => {
    expect(choosePlan(report(fix(10, 1000), fix(0, 0)), [EAST], null).v).toBe(20)
  })

  it('uses direction_id to pick between the two directions of a street', () => {
    const westbound = report(fix(75, 300), fix(0, 600), { directionId: 1 })
    const p = choosePlan(westbound, [EAST, WEST], null)
    expect(p.line).toBe(WEST)
    expect(p.v).toBeCloseTo(4, 6)
  })

  it('without direction_id, picks the shape the bus is moving forward along', () => {
    const p = choosePlan(report(fix(75, 300), fix(0, 600), { directionId: null }), [EAST, WEST], null)
    expect(p.line).toBe(WEST)
  })

  it('keeps the current shape unless another fits more than 10 m better', () => {
    const near = makeLine('near#0', 'R', 0, [0, 6, 3000, 6]) // a variant 6 m over
    const r = report(fix(75, 600, 4), fix(0, 300, 4))
    expect(choosePlan(r, [EAST, near], null).line).toBe(near) // fits best from scratch
    expect(choosePlan(r, [EAST, near], EAST).line).toBe(EAST) // but not worth switching
    const far = makeLine('far#0', 'R', 0, [0, 30, 3000, 30])
    expect(choosePlan(report(fix(75, 600, 29), fix(0, 300, 29)), [EAST, far], EAST).line).toBe(far)
  })

  it('on a loop, snaps B to the pass ahead of A, not the other side of the street', () => {
    // Out along z = 0 to x = 1000, back along z = 12.
    const loop = makeLine('loop#0', 'R', 0, [0, 0, 1000, 0, 1000, 12, 0, 12])
    const p = choosePlan(report(fix(60, 400, 6), fix(0, 200, 1)), [loop], null)
    expect(p.sB).toBeCloseTo(400, 6) // not 1012 + 600 on the return leg
    expect(p.v).toBeCloseTo(200 / 60, 6)
  })
})

describe('display', () => {
  it('missing previous point: stays put, fades in', () => {
    const m = createMotion(report(fix(0, 500), null), [EAST], s(5))
    expect(m.s).toBeCloseTo(500, 6)
    expect(m.appear).toBe(0)
    run(m, 5, 65)
    expect(m.s).toBeCloseTo(500, 6)
    expect(m.appear).toBe(1)
  })

  it('glides forward at the bus speed between updates, never backward', () => {
    const m = createMotion(report(fix(75, 600), fix(0, 300)), [EAST], s(100))
    expect(m.s).toBeCloseTo(600 + 4 * 25, 6) // placed at the target when first seen
    const trace = run(m, 100, 160)
    expect(nonDecreasing(trace)).toBe(true)
    // Tracks the target within the easing lag (v * tau = 12 m).
    expect(targetS(m.plan, s(160)) - m.s).toBeGreaterThan(0)
    expect(targetS(m.plan, s(160)) - m.s).toBeLessThan(13)
  })

  it('a new point behind the drawn bus makes it wait, not reverse', () => {
    const m = createMotion(report(fix(75, 600), fix(0, 300)), [EAST], s(150))
    const before = m.s // ~900
    applyReport(m, report(fix(150, 700), fix(75, 600)), [EAST], s(150)) // the bus had stopped
    const trace = run(m, 150, 200)
    expect(nonDecreasing(trace)).toBe(true)
    expect(m.s).toBeCloseTo(before, 6) // target (~767..) is still behind: holds
    expect(m.ghost).toBeNull()
  })

  it('a new point far ahead is reached by a capped glide, not a jump', () => {
    const m = createMotion(report(fix(75, 600), null), [EAST], s(75))
    applyReport(m, report(fix(150, 900), fix(75, 600)), [EAST], s(150))
    let prev = m.s
    run(m, 150, 170, (mm, dt) => {
      expect(mm.s - prev).toBeLessThanOrEqual(CATCHUP_SPEED * dt + 1e-9)
      prev = mm.s
    })
    expect(m.s).toBeGreaterThan(900)
  })

  it('off route: drawn at the raw position and eased there in a straight line', () => {
    const m = createMotion(report(fix(0, 500), null), [EAST], s(0))
    applyReport(m, report(fix(75, 520, 90), fix(0, 500)), [EAST], s(75))
    expect(m.line).toBeNull()
    run(m, 75, 95)
    expect(m.x).toBeCloseTo(520, 0)
    expect(m.z).toBeCloseTo(90, 0)
    expect(m.ghost).toBeNull() // 90 m away: eased, not re-snapped
  })

  it('stale after 3 minutes: frozen in place', () => {
    const m = createMotion(report(fix(75, 600), fix(0, 300)), [EAST], s(75))
    run(m, 75, 75 + STALE_MS / 1000 - 1)
    expect(isStale(m, s(75 + STALE_MS / 1000 - 1))).toBe(false)
    const frozen = m.s
    run(m, 75 + STALE_MS / 1000 + 1, 75 + STALE_MS / 1000 + 60)
    expect(isStale(m, s(75 + STALE_MS / 1000 + 1))).toBe(true)
    expect(m.s).toBeCloseTo(frozen, 0)
    // A fresh point revives it.
    applyReport(m, report(fix(400, 1700), fix(325, 1400)), [EAST], s(400))
    expect(isStale(m, s(401))).toBe(false)
  })

  it('smooths speed with the previous update on the same shape', () => {
    const m = createMotion(report(fix(75, 600), fix(0, 300)), [EAST], s(75)) // 4 m/s
    applyReport(m, report(fix(150, 1050), fix(75, 600)), [EAST], s(150)) // 6 m/s this interval
    expect(m.plan.v).toBeCloseTo(5, 9)
    // Not across a change of shape: a new shape starts from its own speed.
    const other = makeLine('other#0', 'R', 0, [0, 500, 3000, 500])
    applyReport(m, report(fix(225, 900, 500), fix(150, 600, 500)), [other], s(225))
    expect(m.plan.v).toBeCloseTo(4, 9)
  })

  it('ignores repeated reports (current_state re-read every 30 s)', () => {
    const r = report(fix(75, 600), fix(0, 300))
    const m = createMotion(r, [EAST], s(80))
    run(m, 80, 100)
    const snapshot = { s: m.s, plan: m.plan }
    applyReport(m, { ...r }, [EAST], s(100))
    expect(m.plan).toBe(snapshot.plan)
    expect(m.s).toBe(snapshot.s)
  })

  it('re-snaps with a crossfade when a point lands 400+ m behind', () => {
    const m = createMotion(report(fix(75, 2000), null), [EAST], s(75))
    applyReport(m, report(fix(150, 2000 - RESNAP_M - 200), fix(75, 2000)), [EAST], s(150))
    expect(m.ghost).toMatchObject({ x: 2000, age: 0 })
    expect(m.appear).toBe(0)
    expect(m.s).toBeCloseTo(1400, 6)
    run(m, 150, 151)
    expect(m.ghost).toBeNull()
    expect(m.appear).toBe(1)
  })

  it('switching to an overlapping variant continues smoothly, no fade', () => {
    const shortVariant = makeLine('short#0', 'R', 0, [500, 0, 1500, 0])
    const m = createMotion(report(fix(75, 600), fix(0, 300)), [EAST], s(80))
    const x = m.x
    applyReport(m, report(fix(150, 900), fix(75, 600)), [shortVariant], s(80))
    expect(m.line).toBe(shortVariant)
    expect(m.ghost).toBeNull()
    expect(m.x).toBeCloseTo(x, 6)
    expect(m.s).toBeCloseTo(x - 500, 6) // same spot, measured on the new shape
  })

  it('switching to a shape somewhere else fades across', () => {
    const elsewhere = makeLine('else#0', 'R', 0, [0, 2000, 3000, 2000])
    const m = createMotion(report(fix(75, 600), fix(0, 300)), [EAST], s(75))
    applyReport(m, report(fix(150, 900, 2000), fix(75, 600, 2000)), [elsewhere], s(150))
    expect(m.line).toBe(elsewhere)
    expect(m.ghost).not.toBeNull()
  })
})

describe('property: never backward, never faster than the cap', () => {
  // Deterministic PRNG so a failure reproduces.
  function rng(seed: number) {
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 4294967296
    }
  }

  // A trip along EAST: a point every 60-90 s at the speed speedFor() picks,
  // with +-8 m GPS noise, seen by the browser 10-100 s late and polled twice.
  // Checks every frame; returns the re-snaps (with where the bus truly was).
  function trip(seed: number, speedFor: (rand: () => number) => number) {
    const rand = rng(seed)
    let truth = 100
    let t = 0
    let latest: Fix = fix(0, truth)
    let clock = 0
    const m = createMotion(report(latest, null), [EAST], s(0))
    let last = m.s
    const resnaps: { from: number; to: number; target: number }[] = []
    for (let k = 0; k < 30 && truth < 2800; k++) {
      const dt = 60 + rand() * 30
      truth = Math.min(2900, truth + speedFor(rand) * dt)
      t += dt
      const prev = latest
      latest = fix(t, truth + (rand() - 0.5) * 16, (rand() - 0.5) * 16)
      const seen = Math.max(clock, t + 10 + rand() * 90)
      run(m, clock, seen, (mm, d) => {
        expect(mm.s - last).toBeGreaterThanOrEqual(-1e-9) // never backward
        expect(mm.s - last).toBeLessThanOrEqual(CATCHUP_SPEED * d + 1e-9) // never a jump
        last = mm.s
      })
      clock = seen
      const ghostBefore = m.ghost
      applyReport(m, report(latest, prev), [EAST], s(seen))
      applyReport(m, report(latest, prev), [EAST], s(seen)) // the same row again
      if (m.ghost && m.ghost !== ghostBefore) resnaps.push({ from: last, to: m.s, target: targetS(m.plan, s(seen)) })
      else expect(m.s - last).toBeGreaterThanOrEqual(-1e-9)
      last = m.s
    }
    return resnaps
  }

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('moving trip %i: glides the whole way, no re-snaps', (seed) => {
    // Muni-like: 1-8 m/s, drifting by up to +-2.5 m/s from one interval to the next.
    let v = 4
    expect(
      trip(seed, (rand) => {
        v = Math.min(8, Math.max(1, v + (rand() - 0.5) * 5))
        return v
      }),
    ).toEqual([])
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('stop-and-go trip %i: a re-snap only ever pulls back onto the new target', (seed) => {
    // Harsh: dead stops a quarter of the time, otherwise up to 12 m/s. A
    // stop after a fast stretch can leave the drawn bus 400+ m ahead; it
    // then fades back instead of freezing there until the bus catches up.
    for (const r of trip(seed, (rand) => (rand() < 0.25 ? 0 : rand() * 12))) {
      expect(r.to).toBeLessThan(r.from - RESNAP_M)
      expect(r.to).toBeCloseTo(r.target, 6)
    }
  })
})
