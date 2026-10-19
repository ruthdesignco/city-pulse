// Light trails: the stretch of route a bus covered over about one feed
// interval, drawn behind it as a ribbon that fades and narrows toward the
// tail. Length is v * TRAIL_S, about 200 m at Muni's ~2.7 m/s, so a trail
// reads as speed: a stopped bus has none, and bunched buses show as trails
// running into each other. Capped so one fast interval doesn't paint a streak.
//
// Each trail is TRAIL_SAMPLES pairs of vertices (left, right of the line),
// head first, written into shared position and color buffers; trailIndex()
// stitches each run of pairs into quads.

import { type ShapeLine, pointAt } from './shapes.ts'

export const TRAIL_S = 75
export const TRAIL_MAX_M = 350
export const TRAIL_MIN_M = 5 // shorter than this isn't drawn
export const TRAIL_SAMPLES = 16
export const TRAIL_TAIL_WIDTH = 0.4 // tail width as a fraction of the head's
export const TRAIL_VERTS_PER_SLOT = TRAIL_SAMPLES * 2
export const TRAIL_INDICES_PER_SLOT = (TRAIL_SAMPLES - 1) * 6

export function trailLength(speed: number): number {
  return Math.min(TRAIL_MAX_M, Math.max(0, speed) * TRAIL_S)
}

export interface Rgb {
  r: number
  g: number
  b: number
}

// Write trail `slot` ending at distance `sHead` along `line`. Brightness
// falls as (1 - u)^2 from `intensity` at the head (u = 0) to 0 at the tail
// (u = 1); with additive blending, black is invisible. Returns false, writing
// nothing, when the trail would be too short to see.
export function writeTrail(
  out: { position: Float32Array; color: Float32Array },
  slot: number,
  line: ShapeLine,
  sHead: number,
  length: number,
  halfWidth: number,
  y: number,
  color: Rgb,
  intensity: number,
): boolean {
  const head = Math.min(line.length, Math.max(0, sHead))
  const len = Math.min(length, head) // stops at the start of the shape
  if (len < TRAIL_MIN_M || intensity <= 0) return false

  let v = slot * TRAIL_VERTS_PER_SLOT
  for (let i = 0; i < TRAIL_SAMPLES; i++) {
    const u = i / (TRAIL_SAMPLES - 1)
    const p = pointAt(line, head - u * len)
    const w = halfWidth * (1 - (1 - TRAIL_TAIL_WIDTH) * u)
    const k = intensity * (1 - u) * (1 - u)
    // Left of the heading, then right: the normal of (hx, hz) is (-hz, hx).
    out.position.set([p.x - p.hz * w, y, p.z + p.hx * w, p.x + p.hz * w, y, p.z - p.hx * w], v * 3)
    out.color.set([color.r * k, color.g * k, color.b * k, color.r * k, color.g * k, color.b * k], v * 3)
    v += 2
  }
  return true
}

// Triangles for `slots` trails: two per quad between consecutive pairs.
export function trailIndex(slots: number): Uint32Array {
  const index = new Uint32Array(slots * TRAIL_INDICES_PER_SLOT)
  let t = 0
  for (let s = 0; s < slots; s++)
    for (let i = 0; i < TRAIL_SAMPLES - 1; i++) {
      const a = s * TRAIL_VERTS_PER_SLOT + i * 2
      index.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], t)
      t += 6
    }
  return index
}
