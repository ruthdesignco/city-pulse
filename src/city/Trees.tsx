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
import { palette } from './palette.ts'
import { RING_DIM_MAX } from './ring.ts'
import type { TreesData } from './treeFormat.ts'
import { type LodAnchor, isNear, nearDistance, shouldReassign } from './treeLod.ts'
import { type TreeLevel, isDoubleSided, isUnitSized, treeGeometry } from './treeModels.ts'
import { TREE_KINDS, type TreeKind, treeSize } from './treeSpecies.ts'
import { useTrees } from './useTrees.ts'

// Street trees from public/trees.bin (scripts/bake-trees.ts): one instanced
// mesh per kind per level of detail (treeModels.ts, treeLod.ts). Each tree's
// transform and color are worked out once; when the camera has moved far
// enough, they're copied into the near or far mesh of its kind. Near trees
// cast shadows; far ones only receive them.

// Per-tree variation, from a hash of the tree's index (stable across
// reloads, since the bake's order is).
const SIZE_JITTER = 0.12
const LIGHTNESS_JITTER = 0.06
const HUE_JITTER = 0.015

const LEVELS: TreeLevel[] = ['near', 'far']

function hash(i: number, salt: number): number {
  let h = Math.imul(i ^ (salt * 0x9e3779b9), 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

interface KindSlot {
  trees: number[] // indices into TreesData
  matrices: Float32Array // 16 per tree, in `trees` order
  greens: Float32Array // 3 per tree, linear
  rings: Float32Array // 1 per tree, 0..1
  geometry: Record<TreeLevel, BufferGeometry>
  green: Record<TreeLevel, InstancedBufferAttribute>
  ring: Record<TreeLevel, InstancedBufferAttribute>
}

function buildSlots(data: TreesData): KindSlot[] {
  const byKind: number[][] = Array.from({ length: TREE_KINDS }, () => [])
  for (let i = 0; i < data.header.count; i++) byKind[data.kind[i]].push(i)
  const dummy = new Object3D()
  const greens = palette.treeGreens.map((c) => new Color(c))
  const c = new Color()
  const hsl = { h: 0, s: 0, l: 0 }

  return byKind.map((trees, kind) => {
    const n = trees.length
    const matrices = new Float32Array(16 * n)
    const greenOf = new Float32Array(3 * n)
    const rings = new Float32Array(n)
    trees.forEach((t, j) => {
      const { height, crown } = treeSize(kind as TreeKind, data.dbh[t])
      const s = 1 + SIZE_JITTER * (2 * hash(t, 1) - 1)
      const w = 1 + SIZE_JITTER * (2 * hash(t, 2) - 1)
      dummy.position.set(data.coords[2 * t] * COORD_QUANTUM, 0, data.coords[2 * t + 1] * COORD_QUANTUM)
      dummy.rotation.set(0, 2 * Math.PI * hash(t, 3), 0)
      if (isUnitSized(kind as TreeKind)) dummy.scale.set(crown * w, height * s, crown * w)
      else dummy.scale.setScalar(s)
      dummy.updateMatrix()
      dummy.matrix.toArray(matrices, 16 * j)
      c.copy(greens[data.tone[t]]).getHSL(hsl)
      c.setHSL(hsl.h + HUE_JITTER * (2 * hash(t, 4) - 1), hsl.s, hsl.l * (1 + LIGHTNESS_JITTER * (2 * hash(t, 5) - 1)))
      c.toArray(greenOf, 3 * j)
      rings[j] = data.ring[t] / 255
    })
    const per = <T,>(f: (level: TreeLevel) => T) => ({ near: f('near'), far: f('far') })
    const green = per(() => new InstancedBufferAttribute(new Float32Array(3 * Math.max(1, n)), 3).setUsage(DynamicDrawUsage))
    const ring = per(() => new InstancedBufferAttribute(new Float32Array(Math.max(1, n)), 1).setUsage(DynamicDrawUsage))
    const geometry = per((level) => {
      const g = treeGeometry(kind as TreeKind, level)
      g.setAttribute('iGreen', green[level])
      g.setAttribute('iRing', ring[level])
      return g
    })
    return { trees, matrices, greens: greenOf, rings, geometry, green, ring }
  })
}

function treeMaterial(doubleSided: boolean): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ roughness: 0.9, metalness: 0, side: doubleSided ? DoubleSide : FrontSide })
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTrunk = { value: new Color(palette.treeTrunk) }
    shader.uniforms.uDim = { value: new Color(palette.sky) }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uTrunk;\nuniform vec3 uDim;\nattribute float aCrown;\nattribute float aTone;\nattribute vec3 iGreen;\nattribute float iRing;\nvarying vec3 vTreeColor;',
      )
      .replace(
        '#include <begin_vertex>',
        // The ring fades toward the haze on ring.ts's curve, like the buildings.
        `#include <begin_vertex>
        vTreeColor = mix(uTrunk, iGreen, aCrown) * aTone;
        vTreeColor = mix(vTreeColor, uDim, ${RING_DIM_MAX.toFixed(3)} * smoothstep(0.0, 1.0, iRing));`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTreeColor;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = vTreeColor;')
  }
  material.customProgramCacheKey = () => `city-trees-v1-${doubleSided ? 'double' : 'front'}`
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

    slots.forEach((slot, kind) => {
      const near = meshes.current[`${kind}-near`]
      const far = meshes.current[`${kind}-far`]
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
      {slots.flatMap((slot, kind) =>
        LEVELS.map((level) => (
          <instancedMesh
            key={`${kind}-${level}`}
            ref={(el) => {
              meshes.current[`${kind}-${level}`] = el
            }}
            args={[slot.geometry[level], isDoubleSided(kind as TreeKind) ? materials.double : materials.front, Math.max(1, slot.trees.length)]}
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
