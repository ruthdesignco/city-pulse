// Every vehicle on screen, frame by frame: each one's own estimate
// (motion.ts), its lane (lanes.ts), and the spacing that keeps them from
// driving through each other (spacing.ts). Vehicles.tsx draws what this
// returns; the replay test (traffic.test.ts) runs the same code without a
// renderer.

import type { CurrentState } from './currentState.ts'
import { MODEL_LENGTH_M, MODEL_WIDTH_M, type VehicleKind } from './fleet.ts'
import { vehiclePose } from './lanes.ts'
import { type Motion, applyReport, createMotion, step } from './motion.ts'
import { type ShapeIndex, type ShapeLine, isUnderground } from './shapes.ts'
import { type Place, type Pose, Spacing } from './spacing.ts'

export interface Drawn {
  m: Motion
  kind: VehicleKind
  scale: number
  pose: Pose
  underground: boolean // a Metro train in the subway (lanes.ts SUBWAY)
}

export class Traffic {
  readonly motions = new Map<string, Motion>()
  private spacing = new Spacing()
  private readonly spaced: boolean

  // spaced false: each vehicle drawn at its own estimate (the replay test's baseline).
  constructor(spaced = true) {
    this.spaced = spaced
  }
  // Where each estimate was last frame, for how far it moved since.
  private last = new Map<string, { line: ShapeLine | null; s: number }>()

  // A new read of current_state. Returns the vehicles that dropped out of it.
  apply(state: CurrentState, index: ShapeIndex, nowMs: number): Motion[] {
    const seen = new Set<string>()
    for (const r of state.vehicles) {
      seen.add(r.id)
      const lines = r.routeId ? index.get(r.routeId) : undefined
      const m = this.motions.get(r.id)
      if (m) applyReport(m, r, lines, nowMs)
      else this.motions.set(r.id, createMotion(r, lines, nowMs))
    }
    const left: Motion[] = []
    for (const [id, m] of this.motions)
      if (!seen.has(id)) {
        this.motions.delete(id)
        this.last.delete(id)
        left.push(m)
      }
    return left
  }

  // Advance every estimate by dtS and place every vehicle. `scaleAt` is how
  // much it's drawn larger than life where it stands (lod.ts; 1 in tests).
  frame(nowMs: number, dtS: number, kindOf: (m: Motion) => VehicleKind, scaleAt: (kind: VehicleKind, x: number, z: number) => number): Drawn[] {
    const items = [...this.motions.values()].map((m) => {
      step(m, nowMs, dtS)
      const kind = kindOf(m)
      const scale = scaleAt(kind, m.x, m.z)
      const prev = this.last.get(m.id)
      const advance = prev && prev.line === m.line && m.line ? m.s - prev.s : 0
      this.last.set(m.id, { line: m.line, s: m.s })
      return { m, kind, scale, advance, underground: m.line !== null && isUnderground(m.line, m.s) }
    })
    const holds = !this.spaced
      ? new Map<string, Place>()
      : this.spacing.update(
      items.map(({ m, kind, scale, advance, underground }) => ({
        id: m.id,
        length: MODEL_LENGTH_M[kind] * scale,
        width: MODEL_WIDTH_M[kind] * scale,
        canHold: m.line !== null,
        underground,
        fresh: m.appear < 1,
        advance,
        poseAt: (back: number, left = 0) => vehiclePose(m, kind, scale, back, left),
      })),
      dtS,
    )
    return items.map(({ m, kind, scale, underground }) => {
      const place = holds.get(m.id)
      return { m, kind, scale, underground, pose: vehiclePose(m, kind, scale, place?.back ?? 0, place?.left ?? 0) }
    })
  }

  hold(id: string): number {
    return this.spacing.hold(id)
  }

  side(id: string): number {
    return this.spacing.side(id)
  }
}
