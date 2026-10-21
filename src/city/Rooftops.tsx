import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshDepthMaterial,
  MeshStandardMaterial,
  Object3D,
  type PerspectiveCamera,
  RGBADepthPacking,
  Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { registerHeightFog, sceneUniforms } from '../scene/sceneUniforms.ts'
import { palette } from './palette.ts'
import { ringDim } from './ring.ts'
import { RoofItem, type RoofPiece, generateRooftops } from './rooftops.ts'
import { useCity } from './useCity.ts'

// Rooftop detail (rooftops.ts), one instanced mesh per item kind. Each item
// sinks into its roof as it shrinks on screen, from FADE_PX[0] across to
// FADE_PX[1]: a big tower penthouse lasts further out than an HVAC unit, and
// nothing pops. The shadow pass sinks them sooner (SHADOW_FADE_PX), measured
// from the viewing camera too, so only items big on screen cast shadows.
//
// Items already sunk out of sight never reach the GPU: when the camera has
// moved REASSIGN_FRACTION of its height (or the view changed size), each
// mesh's instance buffer is rewritten with just the items still above
// FADE_PX[1] on screen. Without that, all 47k went through the main, shadow
// and SSAO passes every frame and cost up to 24 fps in close views.

const FADE_PX: [number, number] = [6, 3]
const SHADOW_FADE_PX: [number, number] = [12, 6]
// How far below the roof a fully faded item ends up, m.
const SINK_M = 0.5
const REASSIGN_FRACTION = 0.03
const HVAC_LIGHTNESS_JITTER = 0.08
const PENTHOUSE_SHADE = 0.88

const KINDS = [RoofItem.Hvac, RoofItem.Penthouse, RoofItem.Tank] as const

function colored(g: BufferGeometry, hex: string): BufferGeometry {
  g.deleteAttribute('uv')
  const c = new Color(hex)
  const n = g.getAttribute('position').count
  const color = new Float32Array(3 * n)
  for (let i = 0; i < n; i++) c.toArray(color, 3 * i)
  g.setAttribute('color', new BufferAttribute(color, 3))
  return g.index ? g.toNonIndexed() : g
}

// A unit box standing on y = 0, white: its instance color is its color.
function box(): BufferGeometry {
  return colored(new BoxGeometry(1, 1, 1).translate(0, 0.5, 0), '#ffffff')
}

// A wooden water tank on a steel stand, 3.4 m across and 5 m tall, in its
// own colors (instance color white).
function tank(): BufferGeometry {
  const parts = [
    colored(new CylinderGeometry(1.5, 1.5, 2.9, 10).translate(0, 1.6 + 1.45, 0), palette.roofTankWood),
    colored(new ConeGeometry(1.6, 0.5, 10).translate(0, 4.5 + 0.25, 0), palette.roofTankRoof),
  ]
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) parts.push(colored(new BoxGeometry(0.15, 1.6, 0.15).translate(x, 0.8, z), palette.roofTankStand))
  const merged = mergeGeometries(parts)
  for (const g of parts) g.dispose()
  if (!merged) throw new Error('Rooftops: could not merge the tank')
  // Sized to the unit-box convention: scale (w, h, d) = (3.4, 5, 3.4).
  return merged.scale(1 / 3.4, 1 / 5, 1 / 3.4)
}

// The sink, in the vertex shader, after begin_vertex: `transformed` is the
// item's own unit-box space, base at y = 0.
const FADE_PARS = /* glsl */ `
uniform vec3 uViewPos;
uniform float uPxPerMeter;
`
const fadeVertex = ([full, gone]: [number, number]) => /* glsl */ `
{
  vec3 iPos = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
  vec3 iScale = vec3( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ), length( instanceMatrix[ 2 ].xyz ) );
  float px = max( iScale.x, max( iScale.y, iScale.z ) ) * uPxPerMeter / max( 1.0, distance( iPos, uViewPos ) );
  float fade = smoothstep( ${gone.toFixed(2)}, ${full.toFixed(2)}, px );
  transformed *= fade;
  transformed.y -= ( 1.0 - fade ) * ${SINK_M.toFixed(2)} / iScale.y;
}
`

interface FadeUniforms {
  uViewPos: { value: Vector3 }
  uPxPerMeter: { value: number }
}

const pxPerMeter = (camera: PerspectiveCamera, heightPx: number) => heightPx / (2 * Math.tan(((camera.fov ?? 40) * Math.PI) / 360))

// `ringFade`: the color material also fades the context ring toward the time
// of day's haze (sceneUniforms.ts), per instance (iRingFade).
function withFade<M extends MeshStandardMaterial | MeshDepthMaterial>(material: M, uniforms: FadeUniforms, px: [number, number], key: string, ringFade = false): M {
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    registerHeightFog(shader)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${FADE_PARS}${ringFade ? 'attribute float iRingFade;\nvarying float vRingFade;\n' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${fadeVertex(px)}${ringFade ? 'vRingFade = iRingFade;\n' : ''}`)
    if (ringFade) {
      shader.uniforms.uHaze = sceneUniforms.uHaze
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uHaze;\nvarying float vRingFade;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uHaze, vRingFade);')
    }
  }
  material.customProgramCacheKey = () => key
  return material
}

interface Slot {
  mesh: InstancedMesh
  // Every item of this kind, in the order generated.
  matrices: Float32Array // 16 per item
  colors: Float32Array // 3 per item, linear
  ringFades: Float32Array // 1 per item: how far toward the haze (ring.ts)
  ringFade: InstancedBufferAttribute
  centers: Float32Array // 3 per item
  sizes: Float32Array // largest dimension, m
}

function buildSlots(pieces: RoofPiece[], buildingColorIndex: Uint8Array, uniforms: FadeUniforms): Slot[] {
  const material = withFade(new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }), uniforms, FADE_PX, 'city-rooftops-v3', true)
  const depth = withFade(new MeshDepthMaterial({ depthPacking: RGBADepthPacking }), uniforms, SHADOW_FADE_PX, 'city-rooftops-depth-v2')
  const hvac = new Color(palette.roofHvac)
  const buildingColors = palette.buildingColors.map((c) => new Color(c))
  const dummy = new Object3D()
  const c = new Color()
  const hsl = { h: 0, s: 0, l: 0 }
  hvac.getHSL(hsl)

  return KINDS.map((kind) => {
    const mine = pieces.filter((p) => p.kind === kind)
    const n = mine.length
    const geometry = kind === RoofItem.Tank ? tank() : box()
    const ringFade = new InstancedBufferAttribute(new Float32Array(Math.max(1, n)), 1).setUsage(DynamicDrawUsage)
    geometry.setAttribute('iRingFade', ringFade)
    const slot: Slot = {
      mesh: new InstancedMesh(geometry, material, Math.max(1, n)),
      matrices: new Float32Array(16 * n),
      colors: new Float32Array(3 * n),
      ringFades: new Float32Array(n),
      ringFade,
      centers: new Float32Array(3 * n),
      sizes: new Float32Array(n),
    }
    mine.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z)
      dummy.rotation.set(0, p.yaw, 0)
      dummy.scale.set(p.w, p.h, p.d)
      dummy.updateMatrix()
      dummy.matrix.toArray(slot.matrices, 16 * i)
      if (kind === RoofItem.Hvac) {
        // Per unit, from its position: stable across reloads.
        const j = Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453
        c.setHSL(hsl.h, hsl.s, hsl.l * (1 + HVAC_LIGHTNESS_JITTER * (2 * (j - Math.floor(j)) - 1)))
      } else if (kind === RoofItem.Penthouse) c.copy(buildingColors[buildingColorIndex[p.building]]).multiplyScalar(PENTHOUSE_SHADE)
      else c.setRGB(1, 1, 1)
      c.toArray(slot.colors, 3 * i)
      // The context ring fades toward the haze, as its buildings do (shader).
      slot.ringFades[i] = ringDim(p.ring)
      slot.centers.set([p.x, p.y + p.h / 2, p.z], 3 * i)
      slot.sizes[i] = Math.max(p.w, p.h, p.d)
    })
    const { mesh } = slot
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(3 * Math.max(1, n)), 3).setUsage(DynamicDrawUsage)
    mesh.count = 0
    mesh.customDepthMaterial = depth
    // Instances span the city; the unit geometry's bounds would cull them.
    mesh.frustumCulled = false
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.userData.noReflect = true
    return slot
  })
}

// Rewrite each mesh's instances with just the items still on screen from
// `cam` (FADE_PX[1] or more across).
function reassign(slots: Slot[], cam: Vector3, pxPerM: number) {
  for (const s of slots) {
    const m = s.mesh.instanceMatrix.array as Float32Array
    const col = s.mesh.instanceColor!.array as Float32Array
    const fade = s.ringFade.array as Float32Array
    let k = 0
    for (let i = 0; i < s.sizes.length; i++) {
      const dx = s.centers[3 * i] - cam.x
      const dy = s.centers[3 * i + 1] - cam.y
      const dz = s.centers[3 * i + 2] - cam.z
      const reach = (s.sizes[i] * pxPerM) / FADE_PX[1]
      if (dx * dx + dy * dy + dz * dz > reach * reach) continue
      for (let e = 0; e < 16; e++) m[16 * k + e] = s.matrices[16 * i + e]
      for (let e = 0; e < 3; e++) col[3 * k + e] = s.colors[3 * i + e]
      fade[k] = s.ringFades[i]
      k++
    }
    s.mesh.count = k
    for (const attr of [s.mesh.instanceMatrix, s.mesh.instanceColor!, s.ringFade]) {
      attr.clearUpdateRanges()
      attr.addUpdateRange(0, k * attr.itemSize)
      attr.needsUpdate = true
    }
  }
}

interface Built {
  slots: Slot[]
  uniforms: FadeUniforms
  // Where the instances were last reassigned from.
  anchor: { at: Vector3; pxPerM: number; set: boolean }
}

// Every roof's items as instanced meshes, timed for the console like the
// city's extrusion (Buildings.tsx).
function buildRooftops(city: ReturnType<typeof useCity>): Built {
  const started = performance.now()
  // Set every frame from the viewing camera.
  const uniforms: FadeUniforms = { uViewPos: { value: new Vector3() }, uPxPerMeter: { value: 1000 } }
  const skip = new Set((city.header.pinnedMaterials ?? []).map((p) => p.building))
  const pieces = generateRooftops(city.buildings, city.header.ringMeters, skip)
  const slots = buildSlots(pieces, city.buildings.colorIndex, uniforms)
  console.info(`rooftops: ${pieces.length} items in ${(performance.now() - started).toFixed(0)} ms`)
  return { slots, uniforms, anchor: { at: new Vector3(), pxPerM: 0, set: false } }
}

// Per frame: the fade's camera, and the instances once the camera has
// moved enough to matter.
function update(b: Built, camera: PerspectiveCamera, heightPx: number) {
  const pxPerM = pxPerMeter(camera, heightPx)
  b.uniforms.uViewPos.value.copy(camera.position)
  b.uniforms.uPxPerMeter.value = pxPerM
  const a = b.anchor
  const moved = a.at.distanceTo(camera.position)
  if (a.set && a.pxPerM === pxPerM && moved < REASSIGN_FRACTION * Math.max(50, camera.position.y)) return
  a.at.copy(camera.position)
  a.pxPerM = pxPerM
  a.set = true
  reassign(b.slots, camera.position, pxPerM)
}

export function Rooftops() {
  const city = useCity()
  const built = useMemo(() => buildRooftops(city), [city])
  useEffect(
    () => () => {
      const materials = new Set(built.slots.flatMap((s) => [s.mesh.material as MeshStandardMaterial, s.mesh.customDepthMaterial!]))
      for (const s of built.slots) s.mesh.geometry.dispose()
      for (const m of materials) m.dispose()
    },
    [built],
  )

  useFrame(({ camera, size }) => update(built, camera as PerspectiveCamera, size.height))

  return (
    <>
      {built.slots.map((s, i) => (
        <primitive key={i} object={s.mesh} />
      ))}
    </>
  )
}
