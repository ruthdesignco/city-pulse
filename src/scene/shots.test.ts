import { describe, expect, it } from 'vitest'
import { type Pose, SHOTS, poseAround, shotPose } from './shots.ts'
import { OPENING_POSITION, TARGET } from './view.ts'

const distance = (p: Pose) => Math.hypot(p.position[0] - p.target[0], p.position[1] - p.target[1], p.position[2] - p.target[2])
const polar = (p: Pose) => Math.acos((p.position[1] - p.target[1]) / distance(p))

describe('poseAround', () => {
  it('reproduces the opening view from its distance and angles', () => {
    const p = poseAround(TARGET, 1800, 0.85, -0.47)
    p.position.forEach((v, i) => expect(v).toBeCloseTo(OPENING_POSITION[i]))
  })
})

describe('shotPose', () => {
  const shot = SHOTS[1] // push in

  it('starts at the from pose, ends at the to pose, and holds after', () => {
    expect(shotPose(shot, 0)).toEqual(shot.from)
    expect(shotPose(shot, shot.durationS)).toEqual(shot.to)
    expect(shotPose(shot, shot.durationS + 30)).toEqual(shot.to)
  })

  it('eases: slow at both ends, halfway at the midpoint', () => {
    const at = (t: number) => shotPose(shot, t).position[0]
    const span = shot.to.position[0] - shot.from.position[0]
    expect((at(shot.durationS / 2) - shot.from.position[0]) / span).toBeCloseTo(0.5)
    expect(Math.abs(at(0.1) - at(0))).toBeLessThan(Math.abs(at(shot.durationS / 2 + 0.05) - at(shot.durationS / 2 - 0.05)))
  })

  it('orbits at constant distance and height, turning by rate x time', () => {
    const orbit = SHOTS[6]
    const a = shotPose(orbit, 0)
    const b = shotPose(orbit, 6)
    expect(distance(b)).toBeCloseTo(distance(a))
    expect(b.position[1]).toBeCloseTo(a.position[1])
    const azimuth = (p: Pose) => Math.atan2(p.position[0] - p.target[0], p.position[2] - p.target[2])
    expect(azimuth(b) - azimuth(a)).toBeCloseTo(orbit.orbitRadPerS! * 6)
  })
})

describe('SHOTS', () => {
  it('has the seven walkthrough shots', () => {
    expect(SHOTS).toHaveLength(7)
  })

  // OrbitControls clamps anything outside these, which would jolt a take.
  it('stays inside the orbit limits for the whole of every shot', () => {
    for (const shot of SHOTS)
      for (let t = 0; t <= shot.durationS; t += 0.5) {
        const p = shotPose(shot, t)
        expect(distance(p), `${shot.name} at ${t}s`).toBeGreaterThanOrEqual(800)
        expect(distance(p), `${shot.name} at ${t}s`).toBeLessThanOrEqual(6500)
        expect(polar(p), `${shot.name} at ${t}s`).toBeGreaterThanOrEqual(0.15)
        expect(polar(p), `${shot.name} at ${t}s`).toBeLessThanOrEqual(1.25)
      }
  })
})
