// Each tile's level of detail, from how big things on it look from the
// camera (its nearest point's distance, and the view's pixels per meter):
//
//   near  full detail: windows, storefronts, rooftop items, trees, contact
//         shading. While a floor (NEAR_FLOOR_M) is NEAR_FLOOR_PX or more:
//         past that the windows have faded to their average (facade.ts)
//         and the mid level draws the same average.
//   mid   plain prisms with the windows' average (facade.ts
//         FACADE_AVERAGE); no rooftop items or trees; the woods' canopy.
//   far   the far file's merged blocks (farFormat.ts), on the backdrop's
//         land: once a lot (FAR_LOT_M) is under FAR_LOT_PX, the gaps
//         between a block's buildings are gone too.
//
// A tile changes level only HYSTERESIS past the line, so one sitting on it
// doesn't flip back and forth as the camera drifts.

export type Level = 'far' | 'mid' | 'near'

export const NEAR_FLOOR_M = 3.5
export const NEAR_FLOOR_PX = 2
export const FAR_LOT_M = 10
export const FAR_LOT_PX = 2.5
export const HYSTERESIS = 0.08

export function pxPerMeter(fovDeg: number, viewportHeightPx: number): number {
  return viewportHeightPx / (2 * Math.tan((fovDeg * Math.PI) / 360))
}

export interface Thresholds {
  near: number // m: nearer is near
  far: number // m: further is far
}

export function thresholds(fovDeg: number, viewportHeightPx: number): Thresholds {
  const k = pxPerMeter(fovDeg, viewportHeightPx)
  return { near: (NEAR_FLOOR_M * k) / NEAR_FLOOR_PX, far: (FAR_LOT_M * k) / FAR_LOT_PX }
}

// From (x, y, z) to the nearest point of the square [x0, x0 + size] x
// [z0, z0 + size] at height `groundY`.
export function tileDistance(cam: { x: number; y: number; z: number }, x0: number, z0: number, size: number, groundY = 0): number {
  const dx = Math.max(x0 - cam.x, 0, cam.x - (x0 + size))
  const dz = Math.max(z0 - cam.z, 0, cam.z - (z0 + size))
  return Math.hypot(dx, cam.y - groundY, dz)
}

export function levelFor(distance: number, prev: Level | null, t: Thresholds): Level {
  const nearLine = t.near * (prev === 'near' ? 1 + HYSTERESIS : 1 - HYSTERESIS)
  const farLine = t.far * (prev === 'far' ? 1 - HYSTERESIS : 1 + HYSTERESIS)
  if (prev === null) return distance < t.near ? 'near' : distance < t.far ? 'mid' : 'far'
  if (distance < nearLine) return 'near'
  return distance < farLine ? 'mid' : 'far'
}
