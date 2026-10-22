// Street tree level of detail. Each tree is drawn near (full model, casts a
// shadow) or far (simple model, no shadow) by its distance from the camera.
// The switch sits where a typical crown is NEAR_PX across on screen: past
// that the two models look the same and a tree's shadow is a speck.
//
// Reassigning means rewriting the instance buffers, so it only happens when
// the camera has moved REASSIGN_FRACTION of the switch distance, turned
// REASSIGN_TURN_RAD, or the viewport changed. A tree crossing the line
// between reassignments is a handful of pixels either way.
//
// Trees outside the view (VIEW_CONE_RAD round the camera's direction:
// the frame's corners, with room for REASSIGN_TURN_RAD of turning before
// the next reassignment) aren't drawn at all: the meshes span many tiles,
// so three.js can't cull them, and the trees behind a low camera were as
// many as those in front.

import { metersPerPixel } from '../scene/pixels.ts'

export const NEAR_PX = 8
// A typical street tree's crown diameter (treeSpecies.ts, ~8-12 in DBH).
export const TYPICAL_CROWN_M = 5
export const REASSIGN_FRACTION = 0.03
export const REASSIGN_TURN_RAD = 0.1
// The frame's corners at a 40 deg fov and a 2:1 window are ~39 deg off its
// center.
export const VIEW_CONE_RAD = 0.85
// Trees this close are kept whatever the direction (the camera's own street).
const AROUND_M = 60

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
  // The view direction (unit), where it matters.
  dir?: [number, number, number]
}

export function shouldReassign(last: LodAnchor | null, now: LodAnchor): boolean {
  if (!last || last.near !== now.near) return true
  if (last.dir && now.dir && last.dir[0] * now.dir[0] + last.dir[1] * now.dir[1] + last.dir[2] * now.dir[2] < Math.cos(REASSIGN_TURN_RAD)) return true
  return Math.hypot(now.x - last.x, now.y - last.y, now.z - last.z) > REASSIGN_FRACTION * now.near
}

// Is the point (x, y, z) inside the view cone from `cam` (always, near it)?
export function inView(x: number, y: number, z: number, cam: LodAnchor): boolean {
  if (!cam.dir) return true
  const dx = x - cam.x
  const dy = y - cam.y
  const dz = z - cam.z
  const d = Math.hypot(dx, dy, dz)
  return d < AROUND_M || (dx * cam.dir[0] + dy * cam.dir[1] + dz * cam.dir[2]) / d > Math.cos(VIEW_CONE_RAD)
}

// Is the tree at (x, z), on the ground, within `near` of the camera?
export function isNear(x: number, z: number, cam: LodAnchor): boolean {
  const dx = x - cam.x
  const dz = z - cam.z
  return dx * dx + cam.y * cam.y + dz * dz < cam.near * cam.near
}
