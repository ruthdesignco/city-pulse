// Keeping vehicles from driving through each other. Each vehicle's estimated
// position (motion.ts) comes from its own two GPS points; two buses on one
// street don't know about each other, so their estimates can overlap. This
// adjusts only where they're drawn, by moving a vehicle along its own route,
// never more than MAX_SHIFT_M from its estimate (so what's drawn stays
// within reach of the data); the estimate itself, and so where the next real
// update puts it, is untouched.
//
//   Same lane (heading the same way, abreast within their widths): each
//   queue of vehicles is spaced out front to back, a gap of MIN_GAP_M
//   between one's rear and the next one's front when moving, closing up to
//   QUEUE_GAP_M in a stopped queue (buses laying over at a terminal stand
//   nose to tail). Followers hold back; only when that would take one more
//   than MAX_SHIFT_M behind its estimate does the queue as a whole move up,
//   the front drawn ahead of its estimate.
//   Overtaking: when the data has a follower's estimate PASS_AHEAD_M past
//   the one in front, it isn't held behind; it moves PASS_M to the left, a
//   lane over, passes, and moves back in once clear ahead, as a bus pulls
//   out around one at a stop.
//   Crossing or head-on, with bodies overlapping: the one that got there
//   later yields, holding back until the other is clear. Who yields is
//   remembered for the pair, so it doesn't flip while they pass.
//
// A hold grows only as fast as the estimate moves on (plus a slow
// CREEP_MS), so a vehicle stops rather than backing up, and lets go (or
// pulls ahead) at RELEASE_MS. A vehicle fading in takes its place at once.

export const MIN_GAP_M = 15
export const QUEUE_GAP_M = 4
// The gap closes from MIN_GAP_M to QUEUE_GAP_M below this speed (m/s).
const GAP_SPEED_MS = 5
export const MAX_SHIFT_M = 30
export const CREEP_MS = 2
export const RELEASE_MS = 8
const ALIGNED_COS = 0.8
// Two vehicles abreast within their half widths plus this share a lane.
const LANE_SLACK_M = 0.4
// Bodies closer than this count as touching, for crossings.
const TOUCH_M = 1
const YIELD_STEP_M = 2
const CELL_M = 60
// A yield decision is forgotten this many updates after the pair last met.
const FORGET_AFTER = 120
// Overtaking: how far the follower's estimate must be ahead, how far left it
// pulls out (a lane), how fast (m/s), how far sideways before it moves up
// alongside, and the gap ahead of the passed vehicle before it pulls back in.
const PASS_AHEAD_M = 2
export const PASS_M = 3.3
const PASS_RATE_MS = 3
const PASS_CLEAR_M = 2.8
const MERGE_GAP_M = 3
// Drawn positions this close count as level; then the estimates decide.
const LEVEL_M = 0.5
// Vehicles are looked at together from this far beyond their gap, so a
// queue that's just been spaced out stays a queue.
const REACH_SLACK_M = 15

export interface Pose {
  x: number
  z: number
  hx: number // unit heading
  hz: number
}

export interface Spaced {
  id: string
  length: number // as drawn
  width: number
  canHold: boolean // false off route: drawn where it's reported
  underground: boolean // in the subway: clear of everything on the street
  fresh: boolean // fading in: take a hold at once
  advance: number // m its estimate moved forward since the last update
  // Where it's drawn `back` meters behind its estimate along its route
  // (negative: ahead), and `left` meters to the left of its lane.
  poseAt(back: number, left?: number): Pose
}

// Separating-axis test on two boxes, each grown by `margin` all round.
export function boxesOverlap(a: Pose, al: number, aw: number, b: Pose, bl: number, bw: number, margin = 0): boolean {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const axes: [number, number][] = [
    [a.hx, a.hz],
    [-a.hz, a.hx],
    [b.hx, b.hz],
    [-b.hz, b.hx],
  ]
  for (const [ux, uz] of axes) {
    const ra = (al / 2 + margin) * Math.abs(a.hx * ux + a.hz * uz) + (aw / 2 + margin) * Math.abs(-a.hz * ux + a.hx * uz)
    const rb = (bl / 2 + margin) * Math.abs(b.hx * ux + b.hz * uz) + (bw / 2 + margin) * Math.abs(-b.hz * ux + b.hx * uz)
    if (Math.abs(dx * ux + dz * uz) > ra + rb) return false
  }
  return true
}

// How far ahead along a's heading the two heading lines cross (Infinity if parallel).
function aheadToCrossing(a: Pose, b: Pose): number {
  const den = a.hx * b.hz - a.hz * b.hx
  if (Math.abs(den) < 1e-6) return Infinity
  return ((b.x - a.x) * b.hz - (b.z - a.z) * b.hx) / den
}

// The gap to keep behind a vehicle, by how fast the one following moves.
export function gapFor(speedMs: number): number {
  return QUEUE_GAP_M + (MIN_GAP_M - QUEUE_GAP_M) * Math.min(1, Math.max(0, speedMs) / GAP_SPEED_MS)
}

// Front-to-back positions along a lane for a queue: `est` are the
// estimates (front first), `spacing[k]` the least distance between k and
// k + 1. Followers hold back; if one would be more than `max` behind its
// estimate, the whole queue moves up by the excess, the front by at most
// `max`. Returns each one's shift: + behind its estimate, - ahead.
export function spaceQueue(est: number[], spacing: number[], max: number): number[] {
  const p = est.slice()
  for (let k = 1; k < p.length; k++) p[k] = Math.min(est[k], p[k - 1] - spacing[k - 1])
  const worst = Math.max(...p.map((v, k) => est[k] - v))
  const up = Math.min(max, Math.max(0, worst - max))
  return p.map((v, k) => est[k] - (v + up))
}

export interface Place {
  back: number // m behind its estimate (negative: ahead)
  left: number // m left of its lane, passing
}

export class Spacing {
  private shifts = new Map<string, number>()
  private sides = new Map<string, number>()
  // Who's overtaking whom.
  private passing = new Map<string, string>()
  private yields = new Map<string, { id: string; seen: number }>()
  private tick = 0

  // How far behind its estimate a vehicle is drawn (negative: ahead).
  hold(id: string): number {
    return this.shifts.get(id) ?? 0
  }

  // How far left of its lane it's drawn, overtaking.
  side(id: string): number {
    return this.sides.get(id) ?? 0
  }

  update(vehicles: Spaced[], dtS: number): Map<string, Place> {
    this.tick++
    const n = vehicles.length
    const poses = vehicles.map((v) => v.poseAt(this.hold(v.id), this.side(v.id)))
    const byId = new Map(vehicles.map((v, i) => [v.id, i]))
    const yieldWant = new Float64Array(n)
    // Same-lane neighbors, joined into queues.
    const parent = Array.from({ length: n }, (_, i) => i)
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))

    const grid = new Map<string, number[]>()
    poses.forEach((p, i) => {
      const key = `${Math.floor(p.x / CELL_M)},${Math.floor(p.z / CELL_M)}`
      const list = grid.get(key)
      if (list) list.push(i)
      else grid.set(key, [i])
    })

    const pair = (i: number, j: number) => {
      const a = vehicles[i]
      const b = vehicles[j]
      const pa = poses[i]
      const pb = poses[j]
      if (a.underground !== b.underground) return
      const reach = (a.length + b.length) / 2 + MIN_GAP_M + REACH_SLACK_M
      const dx = pb.x - pa.x
      const dz = pb.z - pa.z
      if (dx * dx + dz * dz > reach * reach) return
      const cos = pa.hx * pb.hx + pa.hz * pb.hz
      if (cos > ALIGNED_COS && Math.abs(pa.hx * dz - pa.hz * dx) <= (a.width + b.width) / 2 + LANE_SLACK_M) {
        parent[find(i)] = find(j)
        return
      }
      if (!boxesOverlap(pa, a.length, a.width, pb, b.length, b.width, TOUCH_M)) return
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`
      let y = this.yields.get(key)?.id
      if (y !== a.id && y !== b.id) {
        // The later arrival: farther from where their paths cross.
        if (!a.canHold) y = b.id
        else if (!b.canHold) y = a.id
        else y = aheadToCrossing(pa, pb) >= aheadToCrossing(pb, pa) ? a.id : b.id
      }
      this.yields.set(key, { id: y, seen: this.tick })
      const [k, other, po] = y === a.id ? [i, b, pb] : [j, a, pa]
      const yielder = vehicles[k]
      if (!yielder.canHold) return
      let back = 0
      while (back < MAX_SHIFT_M && boxesOverlap(yielder.poseAt(back), yielder.length, yielder.width, po, other.length, other.width, TOUCH_M))
        back += YIELD_STEP_M
      yieldWant[k] = Math.max(yieldWant[k], Math.min(MAX_SHIFT_M, back))
    }

    for (const [key, list] of grid) {
      const [cx, cz] = key.split(',').map(Number)
      for (let gx = cx - 1; gx <= cx + 1; gx++)
        for (let gz = cz - 1; gz <= cz + 1; gz++) {
          const other = grid.get(`${gx},${gz}`)
          if (other) for (const i of list) for (const j of other) if (i < j) pair(i, j)
        }
    }

    // Each queue, front to back along its front vehicle's heading: by where
    // they're drawn now (so the order holds steady), then by estimate, then id.
    const target = Float64Array.from(yieldWant)
    const queues = new Map<number, number[]>()
    for (let i = 0; i < n; i++) {
      const r = find(i)
      const q = queues.get(r)
      if (q) q.push(i)
      else queues.set(r, [i])
    }
    for (const q of queues.values()) {
      if (q.length < 2) continue
      const axis = poses[q[0]]
      const along = (p: Pose) => p.x * axis.hx + p.z * axis.hz
      const est = new Map(q.map((i) => [i, along(vehicles[i].poseAt(0))]))
      q.sort((i, j) => {
        const d = along(poses[j]) - along(poses[i])
        if (Math.abs(d) > LEVEL_M) return d
        return est.get(j)! - est.get(i)! || (vehicles[i].id < vehicles[j].id ? -1 : 1)
      })
      // A follower the data has already put ahead of the one in front pulls
      // out to pass instead of queueing.
      const chain = [q[0]]
      for (const j of q.slice(1)) {
        const l = chain[chain.length - 1]
        if (vehicles[j].canHold && !this.passing.has(vehicles[j].id) && est.get(j)! > est.get(l)! + PASS_AHEAD_M) this.passing.set(vehicles[j].id, vehicles[l].id)
        if (this.passing.has(vehicles[j].id)) continue
        chain.push(j)
      }
      const spacing = chain.slice(0, -1).map((i, k) => {
        const f = vehicles[chain[k + 1]]
        return (vehicles[i].length + f.length) / 2 + gapFor(f.advance / Math.max(dtS, 1e-3))
      })
      const shift = spaceQueue(
        chain.map((i) => est.get(i)!),
        spacing,
        MAX_SHIFT_M,
      )
      chain.forEach((i, k) => {
        if (vehicles[i].canHold) target[i] = yieldWant[i] > 0 ? Math.max(yieldWant[i], shift[k]) : shift[k]
      })
    }

    // Overtaking: hold position until a lane over, then move up; done once
    // clear ahead of the other (or back behind it, if the data says so after all).
    const sideTarget = new Float64Array(n)
    for (const [id, otherId] of this.passing) {
      const i = byId.get(id)
      const o = otherId === undefined ? undefined : byId.get(otherId)
      if (i === undefined || o === undefined) {
        this.passing.delete(id)
        continue
      }
      const p = poses[i]
      const ahead = (poses[o].x - p.x) * -p.hx + (poses[o].z - p.z) * -p.hz
      const clear = (vehicles[i].length + vehicles[o].length) / 2 + MERGE_GAP_M
      const estAhead = (vehicles[i].poseAt(0).x - vehicles[o].poseAt(0).x) * p.hx + (vehicles[i].poseAt(0).z - vehicles[o].poseAt(0).z) * p.hz
      if (ahead > clear || (ahead < -clear && estAhead < 0)) {
        this.passing.delete(id)
        continue
      }
      sideTarget[i] = PASS_M
      if (this.side(id) < PASS_CLEAR_M) target[i] = Math.max(target[i], this.hold(id))
    }

    const next = new Map<string, number>()
    const nextSide = new Map<string, number>()
    const out = new Map<string, Place>()
    vehicles.forEach((v, i) => {
      if (!v.canHold) return
      const was = this.side(v.id)
      const side = v.fresh ? sideTarget[i] : was + Math.max(-PASS_RATE_MS * dtS, Math.min(PASS_RATE_MS * dtS, sideTarget[i] - was))
      if (side > 0) nextSide.set(v.id, side)
      const cur = this.hold(v.id)
      const t = target[i]
      let h: number
      if (v.fresh) h = t
      else if (t > cur) h = cur + Math.min(t - cur, Math.max(0, v.advance) + CREEP_MS * dtS)
      else h = cur - Math.min(cur - t, RELEASE_MS * dtS)
      h = Math.min(MAX_SHIFT_M, Math.max(-MAX_SHIFT_M, h))
      if (h !== 0) next.set(v.id, h)
      if (h !== 0 || side > 0) out.set(v.id, { back: h, left: side })
    })
    this.shifts = next
    this.sides = nextSide
    for (const [key, y] of this.yields) if (this.tick - y.seen > FORGET_AFTER) this.yields.delete(key)
    return out
  }
}
