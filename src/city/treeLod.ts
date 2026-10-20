// Street tree level of detail. Each tree is drawn near (full model, casts a
// shadow) or far (simple model, no shadow) by its distance from the camera.
// The switch sits where a typical crown is NEAR_PX across on screen: past
// that the two models look the same and a tree's shadow is a speck.
//
// Reassigning means rewriting the instance buffers, so it only happens when
// the camera has moved REASSIGN_FRACTION of the switch distance, or the
// viewport changed. A tree crossing the line between reassignments is a
// handful of pixels either way.

import { metersPerPixel } from '../scene/pixels.ts'

export const NEAR_PX = 8
// A typical street tree's crown diameter (treeSpecies.ts, ~8-12 in DBH).
export const TYPICAL_CROWN_M = 5
export const REASSIGN_FRACTION = 0.03

// Distance (m) inside which trees get the near model.
export function nearDistance(fovDeg: number, viewportHeightPx: number): number {
  // metersPerPixel is linear in distance: solve crown / mpp(d) = NEAR_PX.
  return TYPICAL_CROWN_M / (NEAR_PX * metersPerPixel(1, fovDeg, viewportHeightPx))
}

export interface LodAnchor {
  x: number
  y: number
  z: number
  near: number
}

export function shouldReassign(last: LodAnchor | null, now: LodAnchor): boolean {
  if (!last || last.near !== now.near) return true
  return Math.hypot(now.x - last.x, now.y - last.y, now.z - last.z) > REASSIGN_FRACTION * now.near
}

// Is the tree at (x, z), on the ground, within `near` of the camera?
export function isNear(x: number, z: number, cam: LodAnchor): boolean {
  const dx = x - cam.x
  const dz = z - cam.z
  return dx * dx + cam.y * cam.y + dz * dz < cam.near * cam.near
}
