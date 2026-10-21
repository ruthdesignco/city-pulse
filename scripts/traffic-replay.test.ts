import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCurrentState } from '../src/transit/currentState.ts'
import { MODEL_LENGTH_M, MODEL_WIDTH_M, vehicleKind } from '../src/transit/fleet.ts'
import { type Recording, framesOf } from '../src/transit/replay.ts'
import type { RoutesFile } from '../src/transit/routes-format.ts'
import { buildShapeIndex } from '../src/transit/shapes.ts'
import { MAX_SHIFT_M, PASS_M, boxesOverlap } from '../src/transit/spacing.ts'
import { type Drawn, Traffic } from '../src/transit/traffic.ts'

// The morning recording (15 min, ~400 vehicles) played through the same
// traffic code the scene draws with, at true size, five frames a second.
const ROOT = join(import.meta.dirname, '..')
const routes = JSON.parse(readFileSync(join(ROOT, 'src/data/routes.json'), 'utf8')) as RoutesFile
const recording = JSON.parse(readFileSync(join(ROOT, 'public/recordings/morning.json'), 'utf8')) as Recording
const index = buildShapeIndex(routes)
const typeByRoute = new Map(routes.routes.map((r) => [r.id, r.type]))
const DT_S = 0.2
// Overlap that shows: boxes overlapping by more than this all round.
const SHOWS_M = 0.3

function play(spaced: boolean) {
  const frames = framesOf(recording)
  const traffic = new Traffic(spaced)
  let next = 0
  let overlaps = 0 // pair-frames where two moving vehicles overlap
  let worstShift = 0
  let worstSide = 0
  let last = new Map<string, number>()
  for (let now = frames[0].generatedAt; now <= frames[frames.length - 1].generatedAt + 60_000; now += DT_S * 1000) {
    while (next < frames.length && frames[next].generatedAt <= now) {
      traffic.apply(parseCurrentState(frames[next].row, now), index, now)
      next++
    }
    const drawn = traffic.frame(now, DT_S, (m) => vehicleKind(m.routeId !== null ? typeByRoute.get(m.routeId) : undefined, m.id), () => 1)
    for (const d of drawn) {
      worstShift = Math.max(worstShift, Math.abs(traffic.hold(d.m.id)))
      worstSide = Math.max(worstSide, traffic.side(d.m.id))
    }
    // Faded in, on a route (off-route vehicles are drawn where they're
    // reported), and at least one of the pair moving (buses laying over at
    // a terminal report one spot for several of them at once).
    const moved = (d: Drawn) => (last.get(d.m.id) ?? d.m.s) !== d.m.s
    const shown = drawn.filter((d) => d.m.appear >= 1 && d.m.line)
    for (let i = 0; i < shown.length; i++)
      for (let j = i + 1; j < shown.length; j++) {
        const a = shown[i]
        const b = shown[j]
        if (!moved(a) && !moved(b)) continue
        // A Metro train in the subway and a bus on the street above it don't meet.
        if (a.underground !== b.underground) continue
        if (Math.abs(a.pose.x - b.pose.x) > 30 || Math.abs(a.pose.z - b.pose.z) > 30) continue
        if (boxesOverlap(a.pose, MODEL_LENGTH_M[a.kind], MODEL_WIDTH_M[a.kind], b.pose, MODEL_LENGTH_M[b.kind], MODEL_WIDTH_M[b.kind], -SHOWS_M)) overlaps++
      }
    last = new Map(drawn.map((d) => [d.m.id, d.m.s]))
  }
  return { overlaps, worstShift, worstSide }
}

describe('traffic in a replayed recording', () => {
  const spaced = play(true)
  const raw = play(false)

  it('draws no vehicle more than 30 m from its estimate, or more than a lane aside', () => {
    expect(spaced.worstShift).toBeLessThanOrEqual(MAX_SHIFT_M)
    expect(spaced.worstSide).toBeLessThanOrEqual(PASS_M)
  })

  // Not zero: where the data puts several buses at one spot, or one
  // estimate runs more than the 30 m budget past another, or two directions
  // snap to OSM ways that sit close together, some overlap remains.
  // Measured 2026-10-21: 1011 overlapping pair-frames spaced, 18934 not (95% fewer).
  it('cuts moving vehicles overlapping each other by more than 94%', () => {
    expect(raw.overlaps).toBeGreaterThan(1000)
    expect(spaced.overlaps).toBeLessThan(raw.overlaps * 0.06)
  })
}, 180_000)
