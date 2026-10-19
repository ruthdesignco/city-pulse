// Level of detail for one vehicle: always its 3D model, at true size up
// close and scaled up with distance so it stays findable, by how many pixels
// its real length covers on screen (so it holds at any zoom and window
// size). Below NEAR_PX the model grows to keep NEAR_PX, up to MAX_UPSCALE.
// In the opening view (1.8 km out) a 12 m bus is ~10 px, drawn 3x: ~30 px.

import { metersPerPixel } from '../scene/pixels.ts'

export const NEAR_PX = 60
export const MAX_UPSCALE = 3

export function modelScale(lengthPx: number): number {
  return Math.min(MAX_UPSCALE, Math.max(1, NEAR_PX / Math.max(lengthPx, 1e-6)))
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
