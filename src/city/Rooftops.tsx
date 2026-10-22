import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  type Group,
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
import { RoofItem } from './rooftops.ts'
import { ROOF_FIELDS } from './stream/tileBuild.ts'
import type { NearItems, TileStream } from './stream/TileStream.ts'

// Rooftop detail (rooftops.ts) on the tiles drawn near (stream/TileStream.ts,
// generated in the tile worker), one instanced mesh per item kind. Each item
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

// One tile's items of a kind, worked out once (cached per tile's items).
interface TileKind {
  matrices: Float32Array // 16 per item
  colors: Float32Array // 3 per item, linear
  ringFades: Float32Array // 1 per item: how far toward the haze (ring.ts)
  centers: Float32Array // 3 per item
  sizes: Float32Array // largest dimension, m
}

const perTile = new WeakMap<NearItems, TileKind[]>()

function tileKinds(items: NearItems): TileKind[] {
  let out = perTile.get(items)
  if (out) return out
  const r = items.rooftops
  const n = r.length / ROOF_FIELDS
  const hvac = new Color(palette.roofHvac)
  const buildingColors = palette.buildingColors.map((c) => new Color(c))
  const dummy = new Object3D()
  const c = new Color()
  const hsl = { h: 0, s: 0, l: 0 }
  hvac.getHSL(hsl)
  out = KINDS.map((kind) => {
    const mine: number[] = []
    for (let k = 0; k < n; k++) if (r[k * ROOF_FIELDS + 7] === kind) mine.push(k)
    const t: TileKind = {
      matrices: new Float32Array(16 * mine.length),
      colors: new Float32Array(3 * mine.length),
      ringFades: new Float32Array(mine.length),
      centers: new Float32Array(3 * mine.length),
      sizes: new Float32Array(mine.length),
    }
    mine.forEach((k, i) => {
      const [x, y, z, yaw, w, d, h, , ring, colorIndex] = r.subarray(k * ROOF_FIELDS, (k + 1) * ROOF_FIELDS)
      dummy.position.set(x, y, z)
      dummy.rotation.set(0, yaw, 0)
      dummy.scale.set(w, h, d)
      dummy.updateMatrix()
      dummy.matrix.toArray(t.matrices, 16 * i)
      if (kind === RoofItem.Hvac) {
        // Per unit, from its position: stable across reloads.
        const j = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453
        c.setHSL(hsl.h, hsl.s, hsl.l * (1 + HVAC_LIGHTNESS_JITTER * (2 * (j - Math.floor(j)) - 1)))
      } else if (kind === RoofItem.Penthouse) c.copy(buildingColors[colorIndex]).multiplyScalar(PENTHOUSE_SHADE)
      else c.setRGB(1, 1, 1)
      c.toArray(t.colors, 3 * i)
      // The context ring fades toward the haze, as its buildings do (shader).
      t.ringFades[i] = ringDim(ring)
      t.centers.set([x, y + h / 2, z], 3 * i)
      t.sizes[i] = Math.max(w, h, d)
    })
    return t
  })
  perTile.set(items, out)
  return out
}

interface Slot {
  mesh: InstancedMesh
  capacity: number
  ringFade: InstancedBufferAttribute
}

function makeSlot(kind: RoofItem, capacity: number, material: MeshStandardMaterial, depth: MeshDepthMaterial): Slot {
  const geometry = kind === RoofItem.Tank ? tank() : box()
  const ringFade = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage)
  geometry.setAttribute('iRingFade', ringFade)
  const mesh = new InstancedMesh(geometry, material, capacity)
  mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(3 * capacity), 3).setUsage(DynamicDrawUsage)
  mesh.count = 0
  mesh.customDepthMaterial = depth
  // Instances span many tiles; the unit geometry's bounds would cull them.
  mesh.frustumCulled = false
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.noReflect = true
  return { mesh, capacity, ringFade }
}

// Rewrite each mesh's instances with just the near tiles' items still on
// screen from `cam` (FADE_PX[1] or more across).
function reassign(slots: Slot[], tiles: TileKind[][], cam: Vector3, pxPerM: number) {
  slots.forEach((s, kind) => {
    const m = s.mesh.instanceMatrix.array as Float32Array
    const col = s.mesh.instanceColor!.array as Float32Array
    const fade = s.ringFade.array as Float32Array
    let k = 0
    for (const tile of tiles) {
      const t = tile[kind]
      for (let i = 0; i < t.sizes.length && k < s.capacity; i++) {
        const dx = t.centers[3 * i] - cam.x
        const dy = t.centers[3 * i + 1] - cam.y
        const dz = t.centers[3 * i + 2] - cam.z
        const reach = (t.sizes[i] * pxPerM) / FADE_PX[1]
        if (dx * dx + dy * dy + dz * dz > reach * reach) continue
        for (let e = 0; e < 16; e++) m[16 * k + e] = t.matrices[16 * i + e]
        for (let e = 0; e < 3; e++) col[3 * k + e] = t.colors[3 * i + e]
        fade[k] = t.ringFades[i]
        k++
      }
    }
    s.mesh.count = k
    for (const attr of [s.mesh.instanceMatrix, s.mesh.instanceColor!, s.ringFade]) {
      attr.clearUpdateRanges()
      attr.addUpdateRange(0, k * attr.itemSize)
      attr.needsUpdate = true
    }
  })
}

// The fade's camera, every frame.
function aim(u: FadeUniforms, at: Vector3, pxPerM: number) {
  u.uViewPos.value.copy(at)
  u.uPxPerMeter.value = pxPerM
}

const pxPerMeterOf = (camera: PerspectiveCamera, heightPx: number) => heightPx / (2 * Math.tan(((camera.fov ?? 40) * Math.PI) / 360))

export function Rooftops({ stream }: { stream: TileStream }) {
  const version = useSyncExternalStore(
    (f) => stream.subscribe(f),
    () => stream.nearTiles().version,
  )
  // Set every frame from the viewing camera.
  const uniforms = useMemo<FadeUniforms>(() => ({ uViewPos: { value: new Vector3() }, uPxPerMeter: { value: 1000 } }), [])
  const materials = useMemo(
    () => ({
      color: withFade(new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }), uniforms, FADE_PX, 'city-rooftops-v3', true),
      depth: withFade(new MeshDepthMaterial({ depthPacking: RGBADepthPacking }), uniforms, SHADOW_FADE_PX, 'city-rooftops-depth-v2'),
    }),
    [uniforms],
  )
  const slots = useRef<Slot[]>([])
  const group = useRef<Group>(null)
  // Where the instances were last reassigned from.
  const anchor = useRef({ at: new Vector3(), pxPerM: 0, set: false, version: -1 })
  useEffect(
    () => () => {
      for (const s of slots.current) s.mesh.geometry.dispose()
      materials.color.dispose()
      materials.depth.dispose()
    },
    [materials],
  )

  useFrame(({ camera, size }) => {
    const g = group.current
    if (!g) return
    const cam = camera as PerspectiveCamera
    const pxPerM = pxPerMeterOf(cam, size.height)
    aim(uniforms, camera.position, pxPerM)
    const a = anchor.current
    const moved = a.at.distanceTo(camera.position)
    if (a.set && a.version === version && a.pxPerM === pxPerM && moved < REASSIGN_FRACTION * Math.max(50, camera.position.y)) return
    a.at.copy(camera.position)
    a.pxPerM = pxPerM
    a.set = true
    a.version = version
    const tiles = stream.nearTiles().items.map(tileKinds)
    KINDS.forEach((kind, k) => {
      const total = tiles.reduce((n, t) => n + t[k].sizes.length, 0)
      if (!slots.current[k] || slots.current[k].capacity < total) {
        const old = slots.current[k]
        if (old) {
          g.remove(old.mesh)
          old.mesh.geometry.dispose()
        }
        slots.current[k] = makeSlot(kind, Math.max(16, Math.ceil(total * 1.5)), materials.color, materials.depth)
        g.add(slots.current[k].mesh)
      }
    })
    reassign(slots.current, tiles, camera.position, pxPerM)
  })

  return <group ref={group} />
}
