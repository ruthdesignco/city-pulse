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

// High above the city, clear of every tower and its shadow (Salesforce
// Tower is ~330 m): where ?calibrate puts its swatches (Calibration.tsx),
// looked at nearly straight down.
export const CALIBRATION_CENTER: Vec3 = [TARGET[0], 500, TARGET[2]]

export const PRESETS: Record<string, Pose> = {
  opening: OPENING,
  calibrate: poseAround(CALIBRATION_CENTER, 400, 0.15, -0.47),
  market: poseAround(ON_MARKET_3RD, 380, 0.75, UP_MARKET),
}

// A preset by name, or the opening view for none or an unknown one.
export function presetPose(name: string | null): Pose {
  return (name !== null && Object.hasOwn(PRESETS, name) ? PRESETS[name] : undefined) ?? OPENING
}
