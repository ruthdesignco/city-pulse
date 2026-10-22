import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import {
  type BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  FrontSide,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshStandardMaterial,
  type PerspectiveCamera,
  Vector3,
} from 'three'
import { registerHeightFog, sceneUniforms } from '../scene/sceneUniforms.ts'
import { palette } from './palette.ts'
import { RING_DIM_MAX } from './ring.ts'
import type { TileStream } from './stream/TileStream.ts'
import { type LodAnchor, inView, isNear, nearDistance, shouldReassign } from './treeLod.ts'
import { type TreeLevel, isDoubleSided, treeGeometry, variantsOf } from './treeModels.ts'
import { TREE_KINDS, type TreeKind } from './treeSpecies.ts'

// Trees on the tiles drawn near (stream/TileStream.ts): street trees from
// DataSF and the illustrative ones in parks and woods (bake-trees.ts), set
// up per tile in the tile worker (treeSlots.ts). One instanced mesh per
// kind, crown variant and level of detail (treeModels.ts, treeLod.ts);
// when the camera has moved far enough, or the near tiles change, each
// tree's transform and color are copied into the near or far mesh of its
// kind. Near trees cast shadows; far ones only receive them. Further off
// than the near tiles there are no single trees: the woods' canopy
// (canopy.ts) stands in for them.

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

// Every kind and variant, in treeSlots.ts treeGroups' order.
const GROUPS: { kind: TreeKind; variant: number }[] = []
for (let kind = 0 as TreeKind; kind < TREE_KINDS; kind++) for (let variant = 0; variant < variantsOf(kind); variant++) GROUPS.push({ kind, variant })

interface Slot {
  kind: TreeKind
  capacity: number
  mesh: Record<TreeLevel, InstancedMesh>
  geometry: Record<TreeLevel, BufferGeometry>
  green: Record<TreeLevel, InstancedBufferAttribute>
  ring: Record<TreeLevel, InstancedBufferAttribute>
}

// Room for n trees of a group, at each level (the meshes are remade when a
// group outgrows them, with room to spare).
function makeSlot(kind: TreeKind, variant: number, n: number, materials: { front: MeshStandardMaterial; double: MeshStandardMaterial }): Slot {
  const capacity = Math.max(16, Math.ceil(n * 1.5))
  const per = <T,>(f: (level: TreeLevel) => T) => ({ near: f('near'), far: f('far') })
  const green = per(() => new InstancedBufferAttribute(new Float32Array(3 * capacity), 3).setUsage(DynamicDrawUsage))
  const ring = per(() => new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage))
  const geometry = per((level) => {
    const g = treeGeometry(kind, level, variant)
    g.setAttribute('iGreen', green[level])
    g.setAttribute('iRing', ring[level])
    return g
  })
  const mesh = per((level) => {
    const m = new InstancedMesh(geometry[level], isDoubleSided(kind) ? materials.double : materials.front, capacity)
    m.instanceMatrix.setUsage(DynamicDrawUsage)
    m.count = 0
    // Instances span many tiles, so the model's own bounds would cull them.
    m.frustumCulled = false
    m.castShadow = level === 'near'
    m.receiveShadow = true
    // Left out of the Bay's reflection (BayWater.tsx), like the vehicles.
    m.userData.noReflect = true
    return m
  })
  return { kind, capacity, mesh, geometry, green, ring }
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

export function Trees({ stream }: { stream: TileStream }) {
  const near = useSyncExternalStore(
    (f) => stream.subscribe(f),
    () => stream.nearTiles().version,
  )
  const materials = useMemo(() => ({ front: treeMaterial(false), double: treeMaterial(true) }), [])
  const slots = useRef<(Slot | null)[]>(GROUPS.map(() => null))
  const group = useRef<import('three').Group>(null)
  const anchor = useRef<LodAnchor | null>(null)
  const look = useMemo(() => new Vector3(), [])
  useEffect(() => () => Object.values(materials).forEach((m) => m.dispose()), [materials])
  useEffect(
    () => () => {
      for (const s of slots.current) if (s) LEVELS.forEach((l) => s.geometry[l].dispose())
    },
    [],
  )
  // New near tiles: assign again on the next frame.
  useEffect(() => {
    anchor.current = null
  }, [near])

  useFrame(({ camera, size }) => {
    const cam = camera.position
    camera.getWorldDirection(look)
    const now: LodAnchor = { x: cam.x, y: cam.y, z: cam.z, near: nearDistance((camera as PerspectiveCamera).fov, size.height), dir: [look.x, look.y, look.z] }
    if (!shouldReassign(anchor.current, now) || !group.current) return
    anchor.current = now
    const tiles = stream.nearTiles().items
    GROUPS.forEach(({ kind, variant }, gi) => {
      const total = tiles.reduce((n, t) => n + (t.trees[gi]?.rings.length ?? 0), 0)
      let slot = slots.current[gi]
      if (!slot || slot.capacity < total) {
        if (slot) for (const l of LEVELS) {
          group.current!.remove(slot.mesh[l])
          slot.geometry[l].dispose()
        }
        slot = makeSlot(kind, variant, total, materials)
        for (const l of LEVELS) group.current!.add(slot.mesh[l])
        slots.current[gi] = slot
      }
      const counts = { near: 0, far: 0 }
      // Plain loops, no subarray views: this runs on every few meters of
      // camera motion, over every tree.
      for (const t of tiles) {
        const g = t.trees[gi]
        if (!g) continue
        const n = g.rings.length
        for (let j = 0; j < n; j++) {
          if (!inView(g.xz[2 * j], g.matrices[16 * j + 13], g.xz[2 * j + 1], now)) continue
          const level: TreeLevel = isNear(g.xz[2 * j], g.xz[2 * j + 1], now) ? 'near' : 'far'
          const k = counts[level]++
          const m = slot.mesh[level].instanceMatrix.array as Float32Array
          for (let e = 0; e < 16; e++) m[16 * k + e] = g.matrices[16 * j + e]
          const gr = slot.green[level].array as Float32Array
          for (let e = 0; e < 3; e++) gr[3 * k + e] = g.greens[3 * j + e]
          ;(slot.ring[level].array as Float32Array)[k] = g.rings[j]
        }
      }
      for (const level of LEVELS) {
        const mesh = slot.mesh[level]
        mesh.count = counts[level]
        for (const attr of [mesh.instanceMatrix, slot.green[level], slot.ring[level]]) {
          attr.clearUpdateRanges()
          attr.addUpdateRange(0, counts[level] * attr.itemSize)
          attr.needsUpdate = true
        }
      }
    })
  })

  return <group ref={group} />
}
