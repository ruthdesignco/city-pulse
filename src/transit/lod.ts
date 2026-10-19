// Level of detail for one vehicle, by how many pixels its real length covers
// on screen -- so the bands hold at any zoom and window size.
//
//   >= NEAR_PX        the model at true scale
//   FAR_PX..NEAR_PX   the model, scaled up (at most MAX_UPSCALE) to stay readable
//   below FADE_PX     the glowing marker
//
// Between FADE_PX and FAR_PX both draw: the model shrinks away as the marker
// grows in, so nothing pops. In the opening view (1.8 km out) a 12 m bus is
// ~10 px, so it's a marker, as before.

import { metersPerPixel } from '../scene/pixels.ts'

export const NEAR_PX = 60
export const FAR_PX = 24
export const FADE_PX = 16
export const MAX_UPSCALE = 2

export interface Lod {
  model: number // 0..1, how much of the model draws (scale factor)
  modelScale: number // >= 1, size-up in the mid band
  marker: number // 0..1, how much of the marker draws
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

export function lodFor(lengthPx: number): Lod {
  const modelScale = Math.min(MAX_UPSCALE, Math.max(1, NEAR_PX / Math.max(lengthPx, 1e-6)))
  const model = smooth((lengthPx - FADE_PX) / (FAR_PX - FADE_PX))
  return { model, modelScale, marker: 1 - model }
}

// How many pixels `lengthM` covers at `distance` (side-on, the worst case is
// end-on but the bands are about legibility, not exact size).
export function lengthPx(lengthM: number, distance: number, fovDeg: number, viewportHeightPx: number): number {
  return lengthM / metersPerPixel(distance, fovDeg, viewportHeightPx)
}

// Turn a displayed heading toward `target` (both radians) along the shorter
// way, easing with time constant TURN_TAU_S, so a vehicle doesn't snap at the
// corners of a simplified route line. Position is untouched (motion.ts).
export const TURN_TAU_S = 0.35

export function turnToward(yaw: number, target: number, dtS: number): number {
  let d = (target - yaw) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  else if (d < -Math.PI) d += 2 * Math.PI
  return yaw + d * (1 - Math.exp(-Math.max(0, dtS) / TURN_TAU_S))
}
