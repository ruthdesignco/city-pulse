// Where to draw each bus between feed updates.
//
// A bus has two observations, A (previous) and B (latest). Both are projected
// onto the best-fitting shape of its route (shapes.ts), giving distances
// along it sA and sB, and a speed v = clamp((sB - sA) / (tB - tA), 0, 20 m/s),
// averaged half-and-half with the previous update's v on the same shape (one
// 75 s interval is a noisy predictor of the next).
//
// Target. The bus is assumed to keep moving at v after B:
//   target(t) = sB + v * coast(t - tB)
//   coast(tau) = tau                                        tau <= 45 s
//              = 45 + 30 (1 - e^(-(tau - 45) / 30))          after that
// Linear at first, so the display keeps pace with the bus instead of falling
// behind and sprinting after every update; v is an average over A->B, stops
// included, so this doesn't systematically overshoot. Then it eases to a
// halt: a dead feed parks each bus at most 75 s of travel ahead. The numbers
// were tuned against simulated trips (points every 60-90 s, seen 10-100 s
// late): a shorter coast overshoots less, so buses rarely wait for the next
// point, at a small cost in average error.
//
// Display. Each frame the shown distance s follows the target:
//   s += max(0, min((target - s) (1 - e^(-dt / 3 s)), 30 m/s * dt))
// The max(0, ...) means a bus never moves backward: if a new point lands
// behind it, it waits until the target passes it. The speed cap turns a
// forward correction into a glide instead of a jump.
//
// Edge cases:
//   no usable previous point      v = 0, the bus sits at sB
//   B more than 40 m from every   off route: drawn at its raw position, eased
//   shape, or an unknown route    there in a straight line, no extrapolation
//   sB < sA (noise or reversal),  v = 0
//   tB <= tA, or tB - tA > 5 min
//   a different shape that        fade out here and in there instead of
//   doesn't overlap, or a point   sliding backward
//   400+ m behind
//   now - tB > 3 min              stale: frozen in place (and dimmed by the
//                                 renderer)

import { type ShapeLine, pointAt, projectOnLine } from './shapes.ts'

export const OFF_ROUTE_M = 40
export const BACKTRACK_TOLERANCE_M = 15
export const SWITCH_MARGIN_M = 10
export const MAX_SPEED = 20 // m/s, cap on inferred bus speed
export const CATCHUP_SPEED = 30 // m/s, cap on displayed speed
export const LINEAR_S = 45
export const DECAY_S = 30
export const SPEED_SMOOTHING = 0.5 // weight of the newest interval's speed
export const EASE_TAU_S = 3
export const MAX_GAP_S = 300
export const RESNAP_M = 400
export const REJOIN_M = 15
export const STALE_MS = 180_000
export const FADE_S = 0.6

export interface Fix {
  t: number // ms, server clock
  x: number // scene meters
  z: number
}

export interface VehicleReport {
  id: string
  routeId: string | null
  directionId: 0 | 1 | null
  latest: Fix
  previous: Fix | null
}

export interface Plan {
  line: ShapeLine | null // null: off route
  sB: number
  tB: number
  v: number // m/s along line
  x: number // raw latest position
  z: number
}

interface Candidate {
  line: ShapeLine
  score: number
  sA: number | null
  sB: number
}

export function coast(tauS: number): number {
  if (tauS <= 0) return 0
  if (tauS <= LINEAR_S) return tauS
  return LINEAR_S + DECAY_S * (1 - Math.exp(-(tauS - LINEAR_S) / DECAY_S))
}

export function targetS(plan: Plan, nowMs: number): number {
  if (!plan.line) return 0
  return Math.min(plan.line.length, plan.sB + plan.v * coast((nowMs - plan.tB) / 1000))
}

function fit(line: ShapeLine, A: Fix | null, B: Fix, dtS: number): Candidate | null {
  const pa = A ? projectOnLine(line, A.x, A.z) : null
  const usableA = pa && pa.d <= OFF_ROUTE_M ? pa : null
  let pb = null
  if (usableA) {
    // Search forward from A first, so a loop that passes the same street
    // twice snaps to the pass the bus is actually on.
    pb = projectOnLine(line, B.x, B.z, usableA.s - BACKTRACK_TOLERANCE_M, usableA.s + MAX_SPEED * dtS + 50)
    if (!pb || pb.d > OFF_ROUTE_M) pb = projectOnLine(line, B.x, B.z)
  } else pb = projectOnLine(line, B.x, B.z)
  if (!pb || pb.d > OFF_ROUTE_M) return null
  if (!usableA) return { line, score: 2 * pb.d, sA: null, sB: pb.s }
  // Wrong way along this shape: only chosen if nothing else fits.
  const backward = pb.s < usableA.s - BACKTRACK_TOLERANCE_M
  return { line, score: usableA.d + pb.d + (backward ? 1000 : 0), sA: backward ? null : usableA.s, sB: pb.s }
}

export function choosePlan(r: VehicleReport, lines: ShapeLine[] | undefined, current: ShapeLine | null): Plan {
  const B = r.latest
  const off: Plan = { line: null, sB: 0, tB: B.t, v: 0, x: B.x, z: B.z }
  if (!lines?.length) return off

  let pool = r.directionId === null ? lines : lines.filter((l) => l.direction === null || l.direction === r.directionId)
  if (!pool.length) pool = lines

  const dtS = r.previous ? (B.t - r.previous.t) / 1000 : 0
  const A = r.previous && dtS > 0 && dtS <= MAX_GAP_S ? r.previous : null

  let best: Candidate | null = null
  let kept: Candidate | null = null
  for (const line of pool) {
    const c = fit(line, A, B, dtS)
    if (!c) continue
    if (!best || c.score < best.score) best = c
    if (line === current) kept = c
  }
  if (!best) return off
  // Hysteresis: overlapping variants score alike; don't flip between them.
  const chosen = kept && kept.score <= best.score + SWITCH_MARGIN_M ? kept : best

  const v = chosen.sA === null || !A ? 0 : Math.min(MAX_SPEED, Math.max(0, (chosen.sB - chosen.sA) / dtS))
  return { line: chosen.line, sB: chosen.sB, tB: B.t, v, x: B.x, z: B.z }
}

// ------------------------------------------------------------- display

export interface Ghost {
  x: number
  z: number
  hx: number
  hz: number
  age: number // s since the re-snap; fades out over FADE_S
}

export interface Motion {
  id: string
  routeId: string | null
  plan: Plan
  line: ShapeLine | null // line currently drawn on; null in free (off-route) mode
  s: number
  x: number
  z: number
  hx: number
  hz: number
  appear: number // 0..1 fade-in
  ghost: Ghost | null
  seenT: number // latest.t of the last report applied
  seenPrevT: number | null
}

function placeOnLine(m: Motion, line: ShapeLine, s: number) {
  const p = pointAt(line, s)
  m.line = line
  m.s = Math.min(line.length, Math.max(0, s))
  m.x = p.x
  m.z = p.z
  m.hx = p.hx
  m.hz = p.hz
}

function resnap(m: Motion, place: () => void) {
  m.ghost = { x: m.x, z: m.z, hx: m.hx, hz: m.hz, age: 0 }
  place()
  m.appear = 0
}

export function createMotion(r: VehicleReport, lines: ShapeLine[] | undefined, nowMs: number): Motion {
  const plan = choosePlan(r, lines, null)
  const m: Motion = {
    id: r.id,
    routeId: r.routeId,
    plan,
    line: null,
    s: 0,
    x: plan.x,
    z: plan.z,
    hx: 1,
    hz: 0,
    appear: 0,
    ghost: null,
    seenT: r.latest.t,
    seenPrevT: r.previous?.t ?? null,
  }
  if (plan.line) placeOnLine(m, plan.line, targetS(plan, nowMs))
  return m
}

// Apply a (possibly repeated) report. current_state is re-read every 30 s
// and usually returns the same points; those are no-ops.
export function applyReport(m: Motion, r: VehicleReport, lines: ShapeLine[] | undefined, nowMs: number) {
  const prevT = r.previous?.t ?? null
  if (r.latest.t === m.seenT && prevT === m.seenPrevT) return
  m.seenT = r.latest.t
  m.seenPrevT = prevT
  m.routeId = r.routeId

  const plan = choosePlan(r, lines, m.line)
  if (plan.line && plan.line === m.plan.line && r.previous)
    plan.v = SPEED_SMOOTHING * plan.v + (1 - SPEED_SMOOTHING) * m.plan.v
  m.plan = plan
  if (!plan.line) {
    m.line = null
    if (Math.hypot(plan.x - m.x, plan.z - m.z) > RESNAP_M)
      resnap(m, () => {
        m.x = plan.x
        m.z = plan.z
      })
    return
  }

  const line = plan.line
  const target = targetS(plan, nowMs)
  if (m.line === line) {
    if (target < m.s - RESNAP_M) resnap(m, () => placeOnLine(m, line, target))
    return
  }
  // New shape (or rejoining from off route): carry on from where the bus is
  // drawn if that spot is on the new shape, else fade across.
  const p = projectOnLine(line, m.x, m.z)
  if (p && p.d <= REJOIN_M && Math.abs(p.s - target) <= RESNAP_M) placeOnLine(m, line, p.s)
  else resnap(m, () => placeOnLine(m, line, target))
}

export function isStale(m: Motion, nowMs: number): boolean {
  return nowMs - m.plan.tB > STALE_MS
}

export function step(m: Motion, nowMs: number, dtS: number) {
  if (dtS <= 0) return
  if (m.appear < 1) m.appear = Math.min(1, m.appear + dtS / FADE_S)
  if (m.ghost) {
    m.ghost.age += dtS
    if (m.ghost.age >= FADE_S) m.ghost = null
  }
  if (isStale(m, nowMs)) return

  const k = 1 - Math.exp(-dtS / EASE_TAU_S)
  const cap = CATCHUP_SPEED * dtS
  if (m.line) {
    const ds = Math.min(Math.max(0, targetS(m.plan, nowMs) - m.s) * k, cap)
    if (ds > 0) placeOnLine(m, m.line, m.s + ds)
    return
  }
  const dx = m.plan.x - m.x
  const dz = m.plan.z - m.z
  const d = Math.hypot(dx, dz)
  if (d < 1e-3) return
  const move = Math.min(d * k, cap)
  m.x += (dx / d) * move
  m.z += (dz / d) * move
  if (d > 0.5) {
    m.hx = dx / d
    m.hz = dz / d
  }
}
