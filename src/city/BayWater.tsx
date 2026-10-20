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
// Ripple scale: the normal map tiles every ~103 / RIPPLE_SIZE m (Water.js).
const RIPPLE_SIZE = 1
// How far the ripples bend the reflection.
const DISTORTION = 1.5
// Water.js darkens shadowed water to black (its body color is all sunlit,
// with no sky fill); real shadows on water are faint, so they only take
// this share of the light away.
const SHADOW_STRENGTH = 0.35
// Ripple drift, in Water.js time units per second.
const RIPPLE_SPEED = 0.4

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
  const darken = '* getShadowMask()'
  if (!material.fragmentShader.includes(darken)) throw new Error('BayWater: Water.js shadow term not found')
  material.fragmentShader = material.fragmentShader.replace(darken, `* mix( 1.0, getShadowMask(), ${SHADOW_STRENGTH.toFixed(2)} )`)
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
