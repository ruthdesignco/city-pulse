import { useFrame } from '@react-three/fiber'
import { sceneUniforms } from './sceneUniforms.ts'
import { CALM_WIND, type Wind, downwind, windStrength } from './wind.ts'

// The wind's clock: App.tsx sets the wind to show (wind.ts) with setWind;
// <WindClock />, mounted once in the Canvas, eases the shader uniforms toward
// it every frame (sceneUniforms.ts uWind*), so a new report turns the water
// and the trees over about 10 s instead of snapping. The direction eases
// as a vector, so it turns the short way round.

// Time constant (s): within 5% of a new wind in about 3 of these.
const EASE_S = 3.5
// The trees' sway, in radians per second of uWindClock: a slow rock in a
// light wind, quicker in a strong one. Accumulated here, so a change of
// speed never jumps the phase.
const SWAY_RATE = [1.1, 2.8]

let target: Wind = CALM_WIND
// Start at the target the first time it's set, so the page doesn't open
// with the wind rising.
let started = false

export function setWind(next: Wind) {
  target = next
  if (started) return
  started = true
  const [x, z] = downwind(next.dirDeg)
  sceneUniforms.uWind.value = windStrength(next.speedMs)
  sceneUniforms.uWindDir.value.set(x, z)
}

// Ease toward the target over `delta` seconds and advance the sway clock.
export function tickWind(delta: number) {
  const k = 1 - Math.exp(-Math.min(delta, 1) / EASE_S)
  const s = windStrength(target.speedMs)
  const [x, z] = downwind(target.dirDeg)
  const w = sceneUniforms.uWind
  const dir = sceneUniforms.uWindDir.value
  w.value += (s - w.value) * k
  dir.set(dir.x + (x - dir.x) * k, dir.y + (z - dir.y) * k)
  if (dir.lengthSq() > 1e-4) dir.normalize()
  else dir.set(x, z)
  sceneUniforms.uWindClock.value += delta * (SWAY_RATE[0] + (SWAY_RATE[1] - SWAY_RATE[0]) * w.value)
}

export function WindClock() {
  useFrame((_, delta) => tickWind(delta))
  return null
}
