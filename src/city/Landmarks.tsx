import { useEffect, useMemo } from 'react'
import { type BufferGeometry, Color, MeshStandardMaterial } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { registerHeightFog, sceneUniforms } from '../scene/sceneUniforms.ts'
import { WINDOW_RADIANCE } from './facade.ts'
import type { CityData } from './format.ts'
import { Glow, place } from './landmarks/build.ts'
import { LANDMARK_MODELS } from './landmarks/models.ts'
import { palette } from './palette.ts'
import { RING_DIM_MAX } from './ring.ts'
import { useCity } from './useCity.ts'
import { LIT_SHARE_GLSL } from './windowLight.ts'

// The landmarks drawn as models (landmarks/registry.ts) where the bake left
// out their footprints, all in one mesh, lit and shadowed like the
// buildings and fading toward the haze in the ring the same way.
//
// Windows (Glow.Windows): a darker band per floor by day; at night each
// window lit or not on the office schedule (windowLight.ts), fading to the
// lit share where the floors are under a few pixels. Floodlit faces
// (Glow.Flood): a warm wash after dusk. Openings (Glow.Opening): dark by
// day, a warm interior glow at night.
const FLOOR_M = 4.4 // the Transamerica Pyramid: 48 floors to 212 m
const WINDOW_COLUMN_M = 1.6
const WINDOW_BAND = [0.3, 0.85] // of a floor, from its foot
const WINDOW_DAY_SHADE = 0.4 // how far a window band darkens toward glass by day
const WINDOW_TINT = new Color('#7d868e')
const FLOOD = new Color('#fff1da')
const FLOOD_RADIANCE = 0.42
const OPENING_RADIANCE = 0.5
const DETAIL_PX = [0.25, 0.6] // floors per pixel: full detail, then only the average

function buildGeometry(city: CityData): BufferGeometry | null {
  const parts = (city.header.landmarkModels ?? []).flatMap((at) => {
    const build = LANDMARK_MODELS[at.id]
    return build ? [place(build(at), at, at.ring)] : []
  })
  return parts.length ? mergeGeometries(parts) : null
}

const f = (v: number) => v.toFixed(4)
const vec3 = (c: Color) => `vec3(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`

function buildMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    registerHeightFog(shader)
    shader.uniforms.uDim = sceneUniforms.uHaze
    shader.uniforms.uWindowsOn = sceneUniforms.uWindowsOn
    shader.uniforms.uHour = sceneUniforms.uHour
    shader.uniforms.uWeekend = sceneUniforms.uWeekend
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glow;\nattribute float ring;\nvarying float vGlow;\nvarying float vRing;\nvarying vec3 vWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;\nvRing = ring;\nvWorld = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uDim;
uniform float uWindowsOn;
uniform float uHour;
uniform float uWeekend;
varying float vGlow;
varying float vRing;
varying vec3 vWorld;
float lmHash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
${LIT_SHARE_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float lmWindows = step( abs( vGlow - ${f(Glow.Windows)} ), 0.5 );
float lmFloor = vWorld.y / ${f(FLOOR_M)};
float lmDetail = 1.0 - smoothstep( ${f(DETAIL_PX[0])}, ${f(DETAIL_PX[1])}, fwidth( lmFloor ) );
float lmBand = mix( ${f(WINDOW_BAND[1] - WINDOW_BAND[0])}, step( ${f(WINDOW_BAND[0])}, fract( lmFloor ) ) * step( fract( lmFloor ), ${f(WINDOW_BAND[1])} ), lmDetail ) * lmWindows;
diffuseColor.rgb = mix( diffuseColor.rgb, ${vec3(WINDOW_TINT)}, ${f(WINDOW_DAY_SHADE)} * lmBand );
diffuseColor.rgb = mix( diffuseColor.rgb, uDim, ${f(RING_DIM_MAX)} * smoothstep( 0.0, 1.0, vRing ) );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  float share = litShare( 0, uHour, uWeekend );
  float lit = step( lmHash( vec2( floor( lmFloor ), floor( ( vWorld.x + vWorld.z ) / ${f(WINDOW_COLUMN_M)} ) ) ), share );
  float windows = lmBand * mix( share, lit, lmDetail );
  float flood = step( abs( vGlow - ${f(Glow.Flood)} ), 0.5 );
  float opening = step( abs( vGlow - ${f(Glow.Opening)} ), 0.5 );
  totalEmissiveRadiance += uWindowsOn * uWindowsOn * windows * ${vec3(new Color(palette.windowWarm))} * ${f(WINDOW_RADIANCE)};
  totalEmissiveRadiance += uWindowsOn * ( flood * ${vec3(FLOOD)} * ${f(FLOOD_RADIANCE)} + opening * ${vec3(new Color(palette.windowSoft))} * ${f(OPENING_RADIANCE)} );
}`,
      )
  }
  material.customProgramCacheKey = () => 'city-landmarks-v1'
  return material
}

export function Landmarks() {
  const city = useCity()
  const geometry = useMemo(() => buildGeometry(city), [city])
  const material = useMemo(() => buildMaterial(), [])
  useEffect(() => () => geometry?.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  if (!geometry) return null
  return <mesh geometry={geometry} material={material} castShadow receiveShadow />
}
