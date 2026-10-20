import { Color } from 'three'
import { palette } from '../city/palette.ts'
import type { SkyState } from './skyState.ts'

// Shader values every city material reads from the time of day (skyClock.ts
// writes them): one object per uniform, shared by reference, so one update
// reaches every material at once.
//
//   uHaze       what the context ring fades toward: the horizon's haze by
//               day, the city-glow night sky after dark (ring.ts)
//   uWindowsOn  0 by day, 1 from dusk: lit windows (facade.ts)
//   uHour       San Francisco local hour, for which windows are lit
export const sceneUniforms = {
  uHaze: { value: new Color(palette.sky) },
  uWindowsOn: { value: 0 },
  uHour: { value: 12 },
}

export function applySkyState(s: SkyState) {
  sceneUniforms.uHaze.value.copy(s.haze)
  sceneUniforms.uWindowsOn.value = s.windowsOn
  sceneUniforms.uHour.value = s.hour
}
