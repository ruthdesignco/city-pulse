// Scripted camera moves for the 2 minute walkthrough, one per shot, so every
// take frames the same way. A shot eases from one pose to another over its
// duration, optionally orbiting its target as it goes. In ?demo mode keys
// 1-7 play them (CameraRig.tsx).
//
// Scene meters, north is -z. Market Street runs from Van Ness (-555, -788)
// northeast through 5th (502, -1776) to Montgomery (1013, -2331). Distances
// stay inside the orbit's limits (view.ts ORBIT_LIMITS).
//
// PRESETS are still camera poses a page can open on (?view=<name>, params.ts),
// for screenshots (npm run shot -- <name> --view <name>) and close looks.

import { OPENING_POSITION, TARGET } from './view.ts'

export type Vec3 = [number, number, number]

export interface Pose {
  position: Vec3
  target: Vec3
}

export interface Shot {
  name: string
  durationS: number
  from: Pose
  to: Pose
  orbitRadPerS?: number
}

// A camera `distance` from `target`, `polar` rad from vertical, at OrbitControls
// azimuth `azimuth` (atan2(x, z) of camera minus target).
export function poseAround(target: Vec3, distance: number, polar: number, azimuth: number): Pose {
  const h = distance * Math.sin(polar)
  return {
    position: [target[0] + h * Math.sin(azimuth), target[1] + distance * Math.cos(polar), target[2] + h * Math.cos(azimuth)],
    target,
  }
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

// Where the camera is `elapsedS` into the shot; holds the end pose after it.
export function shotPose(shot: Shot, elapsedS: number): Pose {
  const t = smooth(elapsedS / shot.durationS)
  const target = lerp3(shot.from.target, shot.to.target, t)
  const position = lerp3(shot.from.position, shot.to.position, t)
  const angle = (shot.orbitRadPerS ?? 0) * Math.min(elapsedS, shot.durationS)
  if (angle === 0) return { position, target }
  // Turn the camera about the target's vertical axis, increasing azimuth.
  const dx = position[0] - target[0]
  const dz = position[2] - target[2]
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { position: [target[0] + dx * c + dz * s, position[1], target[2] + dz * c - dx * s], target }
}

const OPENING: Pose = { position: OPENING_POSITION, target: TARGET }
const MARKET_5TH: Vec3 = [502, 20, -1776]
const VAN_NESS: Vec3 = [-555, 20, -788]
const MONTGOMERY: Vec3 = [1013, 20, -2331]
// Southeast of Market, looking northwest across it.
const ACROSS_MARKET = 0.78
const CLOSE_ON_MARKET = poseAround(MARKET_5TH, 850, 1.0, -0.47)
const ORBIT = poseAround(TARGET, 2600, 1.0, -0.47)

export const SHOTS: Shot[] = [
  { name: 'Hook: drift over SoMa', durationS: 15, from: OPENING, to: OPENING, orbitRadPerS: (2 * Math.PI) / 240 },
  { name: "It's live: push in to Market", durationS: 10, from: OPENING, to: poseAround(MARKET_5TH, 950, 1.0, -0.47) },
  {
    name: 'Two systems: track along Market',
    durationS: 15,
    from: poseAround(VAN_NESS, 900, 1.05, ACROSS_MARKET),
    to: poseAround(MONTGOMERY, 900, 1.05, ACROSS_MARKET),
  },
  { name: 'Honesty 1: hold on Market', durationS: 15, from: CLOSE_ON_MARKET, to: CLOSE_ON_MARKET },
  { name: 'Honesty 2: stale feed (record on ?replay)', durationS: 15, from: CLOSE_ON_MARKET, to: CLOSE_ON_MARKET },
  { name: 'The craft: pull back to the ring', durationS: 15, from: CLOSE_ON_MARKET, to: poseAround(TARGET, 4800, 1.05, -0.2) },
  { name: 'Performance: fast orbit', durationS: 15, from: ORBIT, to: ORBIT, orbitRadPerS: (2 * Math.PI) / 24 },
]

// Over Market at 3rd (Kearny), where the most routes meet, ~380 m out,
// looking northeast straight up the street
// so it runs down the middle of the frame between the buildings: close
// enough that a 40 ft bus is ~60+ px, the vehicle models' near band
// (lod.ts). The point is on the F's route shape (routes.json), at street
// level; Market's axis there is azimuth ~-0.79.
const ON_MARKET_3RD: Vec3 = [741, 0, -2078]
const UP_MARKET = -0.79

// Low and cinematic, down Market Street: 115 m up over Market's centerline
// near 9th (the F line's track: straight from Van Ness (-549, -794) to 3rd
// (741, -2078)), looking northeast along it at a point on the street 700 m
// ahead, so Market's traffic leads the eye up the frame to the downtown
// skyline, which stands against the sky.
const CINEMATIC: Pose = { position: [-124, 115, -1217], target: [372, 0, -1711] }

// Street level, for storefronts, trees and vehicles up close: 30 m up over
// Market between 6th and 7th, the stretch with the most storefront walls
// in view and fewer street trees than 5th-6th, on the F's track as
// CINEMATIC, moved 8 m northwest to the middle of the street,
// looking northeast along it at the street 300 m ahead, so both rows of
// shopfronts converge on the downtown skyline. Polar ~1.47 rad, just
// inside the orbit's ceiling.
const MARKET_DIR: [number, number] = [0.7087, -0.7055] // Van Ness to 3rd, unit
const STREET_AT: Vec3 = [12.4, 30, -1363.6]
const STREET: Pose = {
  position: STREET_AT,
  target: [STREET_AT[0] + 300 * MARKET_DIR[0], 0, STREET_AT[2] + 300 * MARKET_DIR[1]],
}

// High above the city, clear of every tower and its shadow (Salesforce
// Tower is ~330 m): where ?calibrate puts its swatches (Calibration.tsx),
// looked at nearly straight down.
export const CALIBRATION_CENTER: Vec3 = [TARGET[0], 500, TARGET[2]]

// Close looks at the landmark models (src/city/landmarks/): the
// Transamerica Pyramid from the south-southeast, both wings in profile at
// its sides; Coit Tower from the southeast, over North Beach's roofs.
// Centers from the bake (city.bin landmarkModels).
const TRANSAMERICA: Vec3 = [900, 130, -3015]
const COIT: Vec3 = [631, 32, -3815]
// California Street's climb to Nob Hill (the 1 California and the cable
// car; 16 m at Kearny to 87 m at Mason, terrain.ts), seen across it from
// the south and a little east, low, so the slope shows in profile: for the
// terrain, and buses, trees and streets on a steep street. The target is
// on California between Stockton and Powell.
const NOB_HILL: Vec3 = [420, 0, -2695]

export const PRESETS: Record<string, Pose> = {
  transamerica: poseAround(TRANSAMERICA, 430, 1.25, 0.35),
  coit: poseAround(COIT, 200, 1.2, 0.6),
  nobhill: poseAround(NOB_HILL, 300, 1.3, 0.55),
  opening: OPENING,
  calibrate: poseAround(CALIBRATION_CENTER, 400, 0.15, -0.47),
  market: poseAround(ON_MARKET_3RD, 380, 0.75, UP_MARKET),
  cinematic: CINEMATIC,
  street: STREET,
}

// Poses here are written for sea level; on the terrain (city/terrain.ts) a
// pose is lifted by the ground's height under its target, camera and target
// alike, so it frames the same thing on a hill.
export function liftPose(pose: Pose, ground: { heightAt(x: number, z: number): number }): Pose {
  const g = ground.heightAt(pose.target[0], pose.target[2])
  return {
    position: [pose.position[0], pose.position[1] + g, pose.position[2]],
    target: [pose.target[0], pose.target[1] + g, pose.target[2]],
  }
}

// A preset by name, or the opening view for none or an unknown one.
export function presetPose(name: string | null): Pose {
  return (name !== null && Object.hasOwn(PRESETS, name) ? PRESETS[name] : undefined) ?? OPENING
}
