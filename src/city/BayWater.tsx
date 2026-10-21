import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, type Object3D, type ShaderMaterial, Shape, ShapeGeometry, Vector2, Vector3 } from 'three'
import { Water } from 'three/examples/jsm/objects/Water.js'
import { registerHeightFog, sceneUniforms } from '../scene/sceneUniforms.ts'
import { useSkyState } from '../scene/skyClock.ts'
import { TARGET } from '../scene/view.ts'
import type { SkyState } from '../scene/skyState.ts'
import { SUN_POSITION } from '../scene/sun.ts'
import { windStrength } from '../scene/wind.ts'
import { bayOutline } from './bay.ts'
import { palette } from './palette.ts'
import { createWaterNormals } from './waterNormals.ts'

// The Bay (bay.ts) as three's Water: a planar mirror reflection of the sky
// and skyline, rippled by a tiling normal map (waterNormals.ts) that drifts
// over time, with the sun's glints and Fresnel (more sky at grazing angles,
// more of the water's own color looking down). The scene fog fades it into
// the haze toward the horizon like everything else.
//
// The reflection is a second render of the scene from below the water, the
// big cost here. Kept down three ways: a small render target (the ripples
// blur it anyway), at most one reflection per frame (the SSAO normal pass
// draws the scene too, and would otherwise trigger another), and objects
// tagged userData.noReflect (flat street-level layers that can't show in
// the reflection at a useful size) hidden from it.
const REFLECTION_SIZE = 512
// Ripple scale: multiplies world meters before CHOP's own scales.
const RIPPLE_SIZE = 1
// How far the ripples bend the reflection.
const DISTORTION = 1.2
// Water.js darkens shadowed water to black (its body color is all sunlit,
// with no sky fill); real shadows on water are faint, so they only take
// this share of the light away.
const SHADOW_STRENGTH = 0.35
// The wind (windClock.ts uWind, 0 calm .. 1 strong) sets how fast the
// ripples move, how steep they are and how far they bend the reflection:
// calm is near glass, strong is fast, broken chop. Each goes from its first
// value to its second along the square root of the wind's strength, so a
// light breeze already roughens the water, as it does (a 5 m/s breeze is
// about halfway).
// Ripple drift, in Water.js time units per second.
const RIPPLE_SPEED = [0.15, 1.8]
// Ripple slope, relative to the chop below.
const RIPPLE_CHOP = [0.3, 4]
// Reflection distortion, relative to DISTORTION.
const RIPPLE_DISTORTION = [0.3, 2.2]
// On top of each layer's own drift, the whole pattern runs downwind at up
// to this speed (m/s), so the chop shows which way the wind blows.
const DOWNWIND_DRIFT_MS = 3.5
// Whitecaps above WHITECAP_FROM_MS: sparse white flecks, each in its own
// cell of a WHITECAP_CELL_M grid, riding downwind a little faster than the
// chop, swelling and fading over WHITECAP_LIFE_S. Up to WHITECAP_SHARE of
// cells hold one at a time, in a strong wind. Where a cell is under a few
// pixels, their average whitening instead, so nothing shimmers.
const WHITECAP_FROM_MS = 8
const WHITECAP_CELL_M = 8
const WHITECAP_RADIUS = 0.3 // of a cell, at its largest
const WHITECAP_SHARE = 0.16
const WHITECAP_LIFE_S = 4
const WHITECAP_RIDE = 1.4 // times the chop's downwind drift
const WHITECAP_FULL_PX = 6 // cell size on screen for single flecks
const WHITECAP_GONE_PX = 2.5 // and for only the average
const WHITECAP_COLOR = new Color('#e9eef0')
// Water.js's own ripples are one normal map sampled four times, unrotated,
// at two pairs of nearly equal scales: any direction in the map shows up as
// long parallel streaks. This replaces its getNoise with broken bay chop:
// three short layers rotated ~120 deg apart (each one's normals rotated back,
// so lighting stays consistent), drifting different ways, plus one broad
// layer that varies the chop across the Bay. Scales are meters per tile.
const CHOP = [
  { scale: 31, angle: 0, drift: [1 / 17, 1 / 29] },
  { scale: 19, angle: 2.09, drift: [-1 / 19, 1 / 23] },
  { scale: 47, angle: 4.19, drift: [1 / 31, -1 / 13] },
  { scale: 230, angle: 1.05, drift: [-1 / 101, -1 / 97], weight: 0.5 },
]
// Past these distances (m) the ripples flatten toward CALM_FAR_SLOPE of their
// slope: at grazing angles full-strength chop only aliases into sparkle.
const CALM_NEAR_M = 600
const CALM_FAR_M = 4000
const CALM_FAR_SLOPE = 0.35
// In a strong wind, far chop keeps more of its slope (the Bay seen from the
// opening camera should still look rough), up to this.
const WINDY_FAR_SLOPE = 0.7
// At night, a faint warm glow of city light on the water: strongest along
// the waterfront, gone by CITY_GLOW_FAR_M from the city's center (TARGET).
// (The water's mirror reflection is too coarse to carry single lit windows.
// Water.js's shader has a local named `distance`, so length() is used.)
const CITY_GLOW = 0.005
const CITY_GLOW_NEAR_M = 1300
const CITY_GLOW_FAR_M = 3800
// The moon's glints, as a share of the sun's.
const MOON_GLINT = 0.35
// Sun glints: Water.js's shininess and strength are 100 and 2.
const GLINT_SHININESS = 220
const GLINT_STRENGTH = 0.9

const f = (v: number) => v.toFixed(4)
const WHITECAPS_FROM = windStrength(WHITECAP_FROM_MS)
// whitecaps( xz ): 0..1 foam cover at a point on the water.
const WHITECAP_GLSL = `
float wcHash( vec3 p ) {
  return fract( sin( dot( p, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
}
float whitecaps( vec2 xz ) {
  if ( uWhitecaps <= 0.0 ) return 0.0;
  vec2 u = ( xz - uWaterShift * ${f(WHITECAP_RIDE)} ) / ${f(WHITECAP_CELL_M)};
  vec2 cell = floor( u );
  // Each cell's own clock, so flecks don't all swell at once.
  float life = uFoamClock + wcHash( vec3( cell, 7.0 ) );
  float epoch = floor( life );
  float grow = sin( 3.1416 * fract( life ) );
  vec3 id = vec3( cell, epoch );
  float on = step( wcHash( id ), ${f(WHITECAP_SHARE)} * uWhitecaps );
  vec2 centre = 0.3 + 0.4 * vec2( wcHash( id + 1.0 ), wcHash( id + 2.0 ) );
  float r = ${f(WHITECAP_RADIUS)} * grow * ( 0.6 + 0.4 * wcHash( id + 3.0 ) );
  float d = length( ( fract( u ) - centre ) * vec2( 1.0, 1.7 ) );
  float px = fwidth( u.x ) + fwidth( u.y );
  float fleck = on * ( 1.0 - smoothstep( r - px, r + px, d ) );
  // The average: share x mean area of an ellipse whose radius swells and fades.
  float average = ${f(WHITECAP_SHARE)} * uWhitecaps * 3.1416 * ${f(WHITECAP_RADIUS * WHITECAP_RADIUS)} * 0.5 * 0.68 / 1.7;
  float detail = 1.0 - smoothstep( ${f(1 / WHITECAP_FULL_PX)}, ${f(1 / WHITECAP_GONE_PX)}, px * 0.5 );
  return 0.9 * mix( average, fleck, detail );
}
`
const CHOP_GLSL = `
vec3 chopLayer( vec2 uv, float c, float s ) {
  mat2 r = mat2( c, s, -s, c );
  vec3 n = texture2D( normalSampler, r * uv ).xyz * 2.0 - 1.0;
  n.xy = n.xy * r; // rotate the normal back by the inverse rotation
  return n;
}
vec4 getNoise( vec2 uv ) {
  vec3 n = vec3( 0.0 );
  uv -= uWaterShift;
${CHOP.map(
  (l) =>
    `  n += ${f(l.weight ?? 1)} * chopLayer( uv / ${f(l.scale)} + vec2( time * ${f(l.drift[0])}, time * ${f(l.drift[1])} ), ${f(Math.cos(l.angle))}, ${f(Math.sin(l.angle))} );`,
).join('\n')}
  return vec4( n * 0.25, 1.0 );
}
`

// Swaps one exact piece of Water.js's shader, failing loudly if three.js
// changes it out from under us.
function patch(source: string, from: string | RegExp, to: string): string {
  const out = source.replace(from, to)
  if (out === source) throw new Error(`BayWater: Water.js shader no longer contains ${String(from)}`)
  return out
}

// Shapes are built in (x, -z) inside a group rotated -90 deg about X
// (Ground.tsx), so the outline lands at scene z. The water runs under the
// whole of `outline` (the backdrop's box, Ground.tsx): wherever the land
// (the city's terrain, the backdrop's hills) stands above it, it's land;
// the city's own shoreline is bay.ts's, which the terrain bake holds under
// the water (bake-terrain.ts). Without an outline, bay.ts's polygon.
function buildBayGeometry(outline: [number, number][]): ShapeGeometry {
  return new ShapeGeometry(new Shape(outline.map(([x, z]) => new Vector2(x, -z))))
}

function createBayWater(outline: [number, number][]) {
  const mesh = new Water(buildBayGeometry(outline), {
    textureWidth: REFLECTION_SIZE,
    textureHeight: REFLECTION_SIZE,
    waterNormals: createWaterNormals(),
    sunDirection: new Vector3(...SUN_POSITION).normalize(),
    sunColor: palette.sun,
    waterColor: palette.bay,
    distortionScale: DISTORTION,
    fog: true,
  })
  const material = mesh.material as ShaderMaterial
  registerHeightFog(material) // Water.js includes three's fog chunks
  material.uniforms.size.value = RIPPLE_SIZE
  let frag = material.fragmentShader
  frag = patch(frag, /vec4 getNoise\( vec2 uv \) \{[\s\S]*?return noise \* 0\.5 - 1\.0;\s*\}/, CHOP_GLSL)
  frag = patch(
    frag,
    'vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );',
    `float calm = mix( 1.0, mix( ${f(CALM_FAR_SLOPE)}, ${f(WINDY_FAR_SLOPE)}, uWindE ), smoothstep( ${f(CALM_NEAR_M)}, ${f(CALM_FAR_M)}, length( eye - worldPosition.xyz ) ) );
          vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5 * calm * uChop, 1.0, 1.5 * calm * uChop ) );`,
  )
  frag = patch(frag, 'sunLight( surfaceNormal, eyeDirection, 100.0, 2.0, 0.5,', `sunLight( surfaceNormal, eyeDirection, ${f(GLINT_SHININESS)}, ${f(GLINT_STRENGTH)}, 0.5,`)
  frag = patch(frag, '* getShadowMask()', `* mix( 1.0, getShadowMask(), ${f(SHADOW_STRENGTH)} )`)
  frag = patch(
    frag,
    'vec3 outgoingLight = albedo;',
    `vec3 outgoingLight = albedo + uCityGlow * ( uWindowsOn * ${f(CITY_GLOW)} * ( 1.0 - smoothstep( ${f(CITY_GLOW_NEAR_M)}, ${f(CITY_GLOW_FAR_M)}, length( worldPosition.xz - uCity ) ) ) );
          outgoingLight = mix( outgoingLight, uFoamColor, whitecaps( worldPosition.xz ) );`,
  )
  frag = patch(frag, 'void main() {', `${WHITECAP_GLSL}\nvoid main() {`)
  frag = 'uniform float uWindowsOn;\nuniform vec3 uCityGlow;\nuniform vec2 uCity;\nuniform vec2 uWaterShift;\nuniform float uChop;\nuniform float uWindE;\nuniform float uWhitecaps;\nuniform float uFoamClock;\nuniform vec3 uFoamColor;\n' + frag
  material.uniforms.uWindowsOn = sceneUniforms.uWindowsOn
  material.uniforms.uCityGlow = { value: new Color(palette.windowSoft) }
  material.uniforms.uCity = { value: new Vector2(TARGET[0], TARGET[2]) }
  material.uniforms.uWaterShift = { value: new Vector2() }
  material.uniforms.uChop = { value: 1 }
  material.uniforms.uWindE = { value: 0 }
  material.uniforms.uWhitecaps = { value: 0 }
  material.uniforms.uFoamClock = { value: 0 }
  material.uniforms.uFoamColor = { value: new Color() }
  material.fragmentShader = frag
  // Over the ground and the paving (the ring reaches into the water at
  // Mission Bay), under the sidewalks and roads.
  material.polygonOffset = true
  material.polygonOffsetFactor = -0.75
  material.polygonOffsetUnits = -3
  mesh.receiveShadow = true

  let reflected = false
  const reflect = mesh.onBeforeRender
  mesh.onBeforeRender = function (renderer, scene, camera, ...rest) {
    if (reflected || scene.overrideMaterial) return
    reflected = true
    const hidden: Object3D[] = []
    scene.traverseVisible((o) => {
      if (o.userData.noReflect) hidden.push(o)
    })
    for (const o of hidden) o.visible = false
    reflect.call(this, renderer, scene, camera, ...rest)
    for (const o of hidden) o.visible = true
  }

  return {
    mesh,
    // The time of day: glints from the sun or the moon, and the water's own
    // color (Water.js adds it unlit) scaled to the scene's exposure, so the
    // Bay darkens at night with everything else.
    setSky(s: SkyState) {
      material.uniforms.sunDirection.value.copy(s.light.direction)
      // Behind cloud the sun leaves no glints, only the soft sky's sheen.
      const glint = (s.light.isMoon ? MOON_GLINT * Math.min(1, s.light.intensity) : Math.min(1, s.exposure)) * (1 - 0.9 * s.cloud)
      material.uniforms.sunColor.value.copy(s.light.color).multiplyScalar(glint)
      material.uniforms.waterColor.value
        .set(palette.bay)
        .multiplyScalar(s.exposure)
        .lerp(new Color(palette.bayNight), s.sky.night)
      // Foam is lit like everything else: white by day, gray under cloud, dim at night.
      material.uniforms.uFoamColor.value
        .copy(WHITECAP_COLOR)
        .multiplyScalar(Math.min(1, s.exposure) * (1 - 0.25 * s.cloud))
        .lerp(new Color(palette.bayNight).multiplyScalar(2.5), s.sky.night)
    },
    // Once per frame, before rendering: drift the ripples with the wind,
    // allow a new reflection.
    tick(delta: number) {
      const e = Math.sqrt(sceneUniforms.uWind.value)
      const by = (range: number[]) => range[0] + (range[1] - range[0]) * e
      material.uniforms.time.value += delta * by(RIPPLE_SPEED)
      material.uniforms.uWaterShift.value.addScaledVector(sceneUniforms.uWindDir.value, delta * DOWNWIND_DRIFT_MS * e)
      material.uniforms.uChop.value = by(RIPPLE_CHOP)
      material.uniforms.uWindE.value = e
      material.uniforms.uWhitecaps.value = Math.min(1, Math.max(0, (sceneUniforms.uWind.value - WHITECAPS_FROM) / (1 - WHITECAPS_FROM)))
      material.uniforms.uFoamClock.value += delta / WHITECAP_LIFE_S
      material.uniforms.distortionScale.value = DISTORTION * by(RIPPLE_DISTORTION)
      reflected = false
    },
    dispose() {
      mesh.geometry.dispose()
      material.uniforms.normalSampler.value.dispose()
      material.dispose()
    },
  }
}

export function BayWater({ y, outline }: { y: number; outline?: [number, number][] }) {
  const water = useMemo(() => createBayWater(outline ?? bayOutline()), [outline])
  useEffect(() => () => water.dispose(), [water])
  const sky = useSkyState()
  useEffect(() => water.setSky(sky), [water, sky])
  useFrame((_, delta) => water.tick(delta))
  return <primitive object={water.mesh} position-z={y} />
}
