import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { type Object3D, type ShaderMaterial, Shape, ShapeGeometry, Vector2, Vector3 } from 'three'
import { Water } from 'three/examples/jsm/objects/Water.js'
import { SUN_POSITION } from '../scene/sun.ts'
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
// Ripple drift, in Water.js time units per second.
const RIPPLE_SPEED = 0.4
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
// Sun glints: Water.js's shininess and strength are 100 and 2.
const GLINT_SHININESS = 220
const GLINT_STRENGTH = 0.9

const f = (v: number) => v.toFixed(4)
const CHOP_GLSL = `
vec3 chopLayer( vec2 uv, float c, float s ) {
  mat2 r = mat2( c, s, -s, c );
  vec3 n = texture2D( normalSampler, r * uv ).xyz * 2.0 - 1.0;
  n.xy = n.xy * r; // rotate the normal back by the inverse rotation
  return n;
}
vec4 getNoise( vec2 uv ) {
  vec3 n = vec3( 0.0 );
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
// (Ground.tsx), so the outline lands at scene z.
function buildBayGeometry(): ShapeGeometry {
  return new ShapeGeometry(new Shape(bayOutline().map(([x, z]) => new Vector2(x, -z))))
}

function createBayWater() {
  const mesh = new Water(buildBayGeometry(), {
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
  material.uniforms.size.value = RIPPLE_SIZE
  let frag = material.fragmentShader
  frag = patch(frag, /vec4 getNoise\( vec2 uv \) \{[\s\S]*?return noise \* 0\.5 - 1\.0;\s*\}/, CHOP_GLSL)
  frag = patch(
    frag,
    'vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );',
    `float calm = mix( 1.0, ${f(CALM_FAR_SLOPE)}, smoothstep( ${f(CALM_NEAR_M)}, ${f(CALM_FAR_M)}, length( eye - worldPosition.xyz ) ) );
          vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5 * calm, 1.0, 1.5 * calm ) );`,
  )
  frag = patch(frag, 'sunLight( surfaceNormal, eyeDirection, 100.0, 2.0, 0.5,', `sunLight( surfaceNormal, eyeDirection, ${f(GLINT_SHININESS)}, ${f(GLINT_STRENGTH)}, 0.5,`)
  frag = patch(frag, '* getShadowMask()', `* mix( 1.0, getShadowMask(), ${f(SHADOW_STRENGTH)} )`)
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
    // Once per frame, before rendering: drift the ripples, allow a new reflection.
    tick(delta: number) {
      material.uniforms.time.value += delta * RIPPLE_SPEED
      reflected = false
    },
    dispose() {
      mesh.geometry.dispose()
      material.uniforms.normalSampler.value.dispose()
      material.dispose()
    },
  }
}

export function BayWater({ y }: { y: number }) {
  const water = useMemo(() => createBayWater(), [])
  useEffect(() => () => water.dispose(), [water])
  useFrame((_, delta) => water.tick(delta))
  return <primitive object={water.mesh} position-z={y} />
}
