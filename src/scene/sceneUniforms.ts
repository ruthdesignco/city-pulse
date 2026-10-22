import { Color, Vector2, Vector3 } from 'three'
import { palette } from '../city/palette.ts'
import './heightFog.ts'
import { FOG_RAMP_M, FOG_SOFT_M, FOG_TOP_M } from './weather.ts'
import type { SkyState } from './skyState.ts'

// Shader values every city material reads from the time of day (skyClock.ts
// writes them): one object per uniform, shared by reference, so one update
// reaches every material at once.
//
//   uHaze       what the context ring fades toward: the horizon's haze by
//               day, the city-glow night sky after dark (ring.ts)
//   uWindowsOn  0 by day, 1 from dusk: lit windows (facade.ts)
//   uHour       San Francisco local hour, for which windows are lit
//   uWeekend    1 on Saturday and Sunday: the weekend lit-window schedule
//   uFog*       the height fog from the weather (heightFog.ts)
//   uLightDir   toward the sun (or the moon), and uHillshade how strongly
//               the ground's slopes shade against it (city/groundShading.ts):
//               full in sun, weaker under cloud and by moonlight
//   uWind*      the wind, eased (windClock.ts writes them): uWind 0 calm .. 1
//               strong, uWindDir the unit direction it blows toward (scene
//               x, z), uWindClock the trees' sway phase
export const sceneUniforms = {
  uHaze: { value: new Color(palette.sky) },
  // The far sea's haze (SkyDome.tsx sets it as the camera turns): the sky's
  // own horizon there, a shade darker, so the sea runs out to a clear
  // horizon line under it (BayWater.tsx, and the sky below the horizon).
  uSeaFog: { value: new Color(palette.sky) },
  uWindowsOn: { value: 0 },
  uHour: { value: 12 },
  uWeekend: { value: 0 },
  uFogDensity: { value: 0 },
  uFogColor: { value: new Color(palette.fogDay) },
  uFogTop: { value: FOG_TOP_M },
  uFogSoft: { value: FOG_SOFT_M },
  uFogRamp: { value: FOG_RAMP_M },
  uFogGlow: { value: 0 },
  uLightDir: { value: new Vector3(0, 1, 0) },
  uHillshade: { value: 1 },
  uWind: { value: 0 },
  uWindDir: { value: new Vector2(1, 0) },
  uWindClock: { value: 0 },
}

export function applySkyState(s: SkyState) {
  sceneUniforms.uHaze.value.copy(s.haze)
  sceneUniforms.uWindowsOn.value = s.windowsOn
  sceneUniforms.uHour.value = s.hour
  sceneUniforms.uWeekend.value = s.weekend ? 1 : 0
  sceneUniforms.uFogDensity.value = s.fog.density
  sceneUniforms.uFogColor.value.copy(s.fog.color)
  sceneUniforms.uFogTop.value = s.fog.top
  sceneUniforms.uFogSoft.value = s.fog.soft
  sceneUniforms.uFogRamp.value = s.fog.ramp
  sceneUniforms.uFogGlow.value = s.fog.glow
  sceneUniforms.uLightDir.value.copy(s.light.direction)
  sceneUniforms.uHillshade.value = (s.light.isMoon ? 0.35 : 1) * (1 - 0.7 * s.cloud)
}

// Every material drawn with fog calls this from its onBeforeCompile (or uses
// it as one), so the height fog reaches it; the uniforms are shared by
// reference, so a weather change reaches every material at once.
export function registerHeightFog(shader: { uniforms: Record<string, { value: unknown }> }) {
  shader.uniforms.uFogDensity = sceneUniforms.uFogDensity
  shader.uniforms.uFogColor = sceneUniforms.uFogColor
  shader.uniforms.uFogTop = sceneUniforms.uFogTop
  shader.uniforms.uFogSoft = sceneUniforms.uFogSoft
  shader.uniforms.uFogRamp = sceneUniforms.uFogRamp
  shader.uniforms.uFogGlow = sceneUniforms.uFogGlow
}
