import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  type BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  FrontSide,
  InstancedBufferAttribute,
  type InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  type PerspectiveCamera,
} from 'three'
import { COORD_QUANTUM } from './format.ts'
import { registerHeightFog, sceneUniforms } from '../scene/sceneUniforms.ts'
import { palette } from './palette.ts'
import { RING_DIM_MAX } from './ring.ts'
import type { TreesData } from './treeFormat.ts'
import { type LodAnchor, isNear, nearDistance, shouldReassign } from './treeLod.ts'
import { type TreeLevel, isDoubleSided, isUnitSized, treeGeometry, variantsOf } from './treeModels.ts'
import { TREE_KINDS, type TreeKind, treeSize } from './treeSpecies.ts'
import { useTrees } from './useTrees.ts'

// Street trees from src/data/trees.bin (scripts/bake-trees.ts): one instanced
// mesh per kind, crown variant and level of detail (treeModels.ts,
// treeLod.ts). Each tree's
// transform and color are worked out once; when the camera has moved far
// enough, they're copied into the near or far mesh of its kind. Near trees
// cast shadows; far ones only receive them.

// Per-tree variation, from a hash of the tree's baked position (treeKey):
// stable across reloads and across rebakes that add or drop other trees or
// widen the area, which an index-based hash wasn't.
const HEIGHT_JITTER = 0.2
const CROWN_JITTER = 0.22
// Crowns a little oval from above, not perfectly round.
const STRETCH_JITTER = 0.1
const LIGHTNESS_JITTER = 0.06
const HUE_JITTER = 0.015

const LEVELS: TreeLevel[] = ['near', 'far']

// Canopy sway in the wind (sceneUniforms.ts uWind*, windClock.ts): crown
// vertices move downwind and back, more the higher they are, around
// SWAY_PER_M of their height above the ground in a strong wind (some 0.3-0.4
// m at the top of a 10 m tree, more in a gust). Trunks stay put. Each tree's
// phase comes from a hash of its position, so neighbors don't move in step,
// and gusts roll through the street downwind (two slow waves, one along the
// wind and one across it), so the motion swells and eases instead of
// ticking like a metronome. Shadows are drawn unswayed.
const SWAY_PER_M = 0.032
// The mean lean downwind, and the rock about it, as shares of the sway.
const SWAY_LEAN = 0.35
const SWAY_ROCK = [0.5, 0.2] // two sines, the second 2.3x as fast
const SWAY_CROSS = 0.25 // a little across the wind too
// Gusts: the sway scaled by 1 +- GUST_DEPTH, in waves GUST_ALONG_M long
// moving downwind at roughly a strong wind's speed, and GUST_ACROSS_M wide.
const GUST_DEPTH = [0.35, 0.15]
const GUST_ALONG_M = 140
const GUST_ACROSS_M = 300
// uWindClock runs at up to ~2.8 rad/s (windClock.ts); this turns it into a
// gust front moving at ~12 m/s.
const GUST_RATE = (12 * (2 * Math.PI)) / GUST_ALONG_M / 2.8

function hash(i: number, salt: number): number {
  let h = Math.imul(i ^ (salt * 0x9e3779b9), 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// A tree's identity for its variation: its quantized position.
function treeKey(data: TreesData, i: number): number {
  return Math.imul(data.coords[2 * i], 0x27d4eb2d) ^ Math.imul(data.coords[2 * i + 1], 0x165667b1)
}

interface KindSlot {
  kind: TreeKind
  trees: number[] // indices into TreesData
  matrices: Float32Array // 16 per tree, in `trees` order
  greens: Float32Array // 3 per tree, linear
  rings: Float32Array // 1 per tree, 0..1
  geometry: Record<TreeLevel, BufferGeometry>
  green: Record<TreeLevel, InstancedBufferAttribute>
  ring: Record<TreeLevel, InstancedBufferAttribute>
}

function buildSlots(data: TreesData): KindSlot[] {
  const groups: { kind: TreeKind; variant: number; trees: number[] }[] = []
  const groupOf = new Map<number, number[]>()
  for (let kind = 0 as TreeKind; kind < TREE_KINDS; kind++)
    for (let variant = 0; variant < variantsOf(kind); variant++) {
      const trees: number[] = []
      groups.push({ kind, variant, trees })
      groupOf.set(kind * 16 + variant, trees)
    }
  for (let i = 0; i < data.header.count; i++) {
    const kind = data.kind[i] as TreeKind
    groupOf.get(kind * 16 + Math.floor(hash(treeKey(data, i), 6) * variantsOf(kind)))!.push(i)
  }
  const dummy = new Object3D()
  const greens = palette.treeGreens.map((c) => new Color(c))
  const c = new Color()
  const hsl = { h: 0, s: 0, l: 0 }

  return groups.map(({ kind, variant, trees }) => {
    const n = trees.length
    const matrices = new Float32Array(16 * n)
    const greenOf = new Float32Array(3 * n)
    const rings = new Float32Array(n)
    trees.forEach((t, j) => {
      const { height, crown } = treeSize(kind, data.dbh[t])
      const key = treeKey(data, t)
      const s = 1 + HEIGHT_JITTER * (2 * hash(key, 1) - 1)
      const w = 1 + CROWN_JITTER * (2 * hash(key, 2) - 1)
      const oval = STRETCH_JITTER * (2 * hash(key, 7) - 1)
      dummy.position.set(data.coords[2 * t] * COORD_QUANTUM, 0, data.coords[2 * t + 1] * COORD_QUANTUM)
      dummy.rotation.set(0, 2 * Math.PI * hash(key, 3), 0)
      if (isUnitSized(kind)) dummy.scale.set(crown * w * (1 + oval), height * s, crown * w * (1 - oval))
      else dummy.scale.setScalar(s)
      dummy.updateMatrix()
      dummy.matrix.toArray(matrices, 16 * j)
      c.copy(greens[data.tone[t]]).getHSL(hsl)
      c.setHSL(hsl.h + HUE_JITTER * (2 * hash(key, 4) - 1), hsl.s, hsl.l * (1 + LIGHTNESS_JITTER * (2 * hash(key, 5) - 1)))
      c.toArray(greenOf, 3 * j)
      rings[j] = data.ring[t] / 255
    })
    const per = <T,>(f: (level: TreeLevel) => T) => ({ near: f('near'), far: f('far') })
    const green = per(() => new InstancedBufferAttribute(new Float32Array(3 * Math.max(1, n)), 3).setUsage(DynamicDrawUsage))
    const ring = per(() => new InstancedBufferAttribute(new Float32Array(Math.max(1, n)), 1).setUsage(DynamicDrawUsage))
    const geometry = per((level) => {
      const g = treeGeometry(kind, level, variant)
      g.setAttribute('iGreen', green[level])
      g.setAttribute('iRing', ring[level])
      return g
    })
    return { kind, trees, matrices, greens: greenOf, rings, geometry, green, ring }
  })
}

function treeMaterial(doubleSided: boolean): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: doubleSided ? DoubleSide : FrontSide })
  material.onBeforeCompile = (shader) => {
    registerHeightFog(shader)
    shader.uniforms.uTrunk = { value: new Color(palette.treeTrunk) }
    shader.uniforms.uDim = sceneUniforms.uHaze // the ring's fade, by time of day
    shader.uniforms.uWind = sceneUniforms.uWind
    shader.uniforms.uWindDir = sceneUniforms.uWindDir
    shader.uniforms.uWindClock = sceneUniforms.uWindClock
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uTrunk;\nuniform vec3 uDim;\nuniform float uWind;\nuniform vec2 uWindDir;\nuniform float uWindClock;\nattribute float aCrown;\nattribute float aTone;\nattribute vec3 iGreen;\nattribute float iRing;\nvarying vec3 vTreeColor;',
      )
      .replace(
        '#include <begin_vertex>',
        // The ring fades toward the haze on ring.ts's curve, like the buildings.
        `#include <begin_vertex>
        vTreeColor = mix(uTrunk, iGreen, aCrown) * aTone;
        vTreeColor = mix(vTreeColor, uDim, ${RING_DIM_MAX.toFixed(3)} * smoothstep(0.0, 1.0, iRing));`,
      )
      // The sway, in world space (after the instance's own rotation and
      // scale), so every tree leans the same way.
      .replace(
        '#include <project_vertex>',
        `vec4 mvPosition = instanceMatrix * vec4( transformed, 1.0 );
        float swayHeight = max( 0.0, mvPosition.y - instanceMatrix[3].y );
        float swayPhase = 6.2832 * fract( sin( dot( instanceMatrix[3].xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
        float swayAlong = ${SWAY_LEAN.toFixed(3)} + ${SWAY_ROCK[0].toFixed(3)} * sin( uWindClock + swayPhase ) + ${SWAY_ROCK[1].toFixed(3)} * sin( 2.3 * uWindClock + 1.7 * swayPhase );
        float swayAcross = ${SWAY_CROSS.toFixed(3)} * sin( 1.3 * uWindClock + 2.1 * swayPhase );
        vec2 swayAt = instanceMatrix[3].xz;
        float gust = 1.0
          + ${GUST_DEPTH[0].toFixed(3)} * sin( dot( swayAt, uWindDir ) * ${((2 * Math.PI) / GUST_ALONG_M).toFixed(5)} - ${GUST_RATE.toFixed(4)} * uWindClock )
          + ${GUST_DEPTH[1].toFixed(3)} * sin( dot( swayAt, vec2( -uWindDir.y, uWindDir.x ) ) * ${((2 * Math.PI) / GUST_ACROSS_M).toFixed(5)} + 0.37 * uWindClock );
        mvPosition.xz += uWind * gust * aCrown * swayHeight * ${SWAY_PER_M.toFixed(4)} * ( uWindDir * swayAlong + vec2( -uWindDir.y, uWindDir.x ) * swayAcross );
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTreeColor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vTreeColor;')
  }
  material.customProgramCacheKey = () => `city-trees-v3-${doubleSided ? 'double' : 'front'}`
  return material
}

export function Trees() {
  const data = useTrees()
  const slots = useMemo(() => buildSlots(data), [data])
  const materials = useMemo(() => ({ front: treeMaterial(false), double: treeMaterial(true) }), [])
  const meshes = useRef<Record<string, InstancedMesh | null>>({})
  const anchor = useRef<LodAnchor | null>(null)
  useEffect(
    () => () => slots.forEach((s) => LEVELS.forEach((l) => s.geometry[l].dispose())),
    [slots],
  )
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials])
  // New data or remounted meshes: assign again on the next frame.
  useEffect(() => {
    anchor.current = null
  }, [slots])

  useFrame(({ camera, size }) => {
    const cam = camera.position
    const now: LodAnchor = { x: cam.x, y: cam.y, z: cam.z, near: nearDistance((camera as PerspectiveCamera).fov, size.height) }
    if (!shouldReassign(anchor.current, now)) return
    anchor.current = now

    slots.forEach((slot, i) => {
      const near = meshes.current[`${i}-near`]
      const far = meshes.current[`${i}-far`]
      if (!near || !far) return
      const out = { near, far }
      const counts = { near: 0, far: 0 }
      // Plain loops, no subarray views: this runs on every few meters of
      // camera motion, over every tree.
      slot.trees.forEach((t, j) => {
        const level: TreeLevel = isNear(data.coords[2 * t] * COORD_QUANTUM, data.coords[2 * t + 1] * COORD_QUANTUM, now) ? 'near' : 'far'
        const k = counts[level]++
        const m = out[level].instanceMatrix.array as Float32Array
        for (let e = 0; e < 16; e++) m[16 * k + e] = slot.matrices[16 * j + e]
        const g = slot.green[level].array as Float32Array
        for (let e = 0; e < 3; e++) g[3 * k + e] = slot.greens[3 * j + e]
        ;(slot.ring[level].array as Float32Array)[k] = slot.rings[j]
      })
      for (const level of LEVELS) {
        const mesh = out[level]
        mesh.count = counts[level]
        for (const attr of [mesh.instanceMatrix, slot.green[level], slot.ring[level]]) {
          attr.clearUpdateRanges()
          attr.addUpdateRange(0, counts[level] * attr.itemSize)
          attr.needsUpdate = true
        }
      }
    })
  })

  // Instances span the whole city, so the models' own bounds would cull them.
  // Left out of the Bay's reflection (BayWater.tsx), like the vehicles.
  return (
    <>
      {slots.flatMap((slot, i) =>
        LEVELS.map((level) => (
          <instancedMesh
            key={`${i}-${level}`}
            ref={(el) => {
              meshes.current[`${i}-${level}`] = el
            }}
            args={[slot.geometry[level], isDoubleSided(slot.kind) ? materials.double : materials.front, Math.max(1, slot.trees.length)]}
            count={0}
            frustumCulled={false}
            castShadow={level === 'near'}
            receiveShadow
            userData={{ noReflect: true }}
          />
        )),
      )}
    </>
  )
}
