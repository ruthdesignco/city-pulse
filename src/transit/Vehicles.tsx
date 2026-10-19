import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  type InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  type PerspectiveCamera,
} from 'three'
import { palette } from '../city/palette.ts'
import { minPixelScale } from '../scene/pixels.ts'
import type { CurrentState } from './currentState.ts'
import { type VehicleKind, vehicleKind } from './fleet.ts'
import { staleDim } from './freshness.ts'
import { lengthPx, lodFor, turnToward } from './lod.ts'
import { FADE_S, type Motion, applyReport, createMotion, step } from './motion.ts'
import { TRAIL_INDICES_PER_SLOT, TRAIL_VERTS_PER_SLOT, trailIndex, trailLength, writeTrail } from './trails.ts'
import { useRoutes } from './useRoutes.ts'
import { MODEL_LENGTH_M, MODEL_WIDTH_M, buildVehicleGeometry, vehicleMaterial } from './vehicleModels.ts'

// Far away (lod.ts) a vehicle is a glowing marker, drawn larger than life (a
// bus is 12-18 m) so it reads from the orbit camera, up to 6500 m out.
// Closer in it's a low poly model (vehicleModels.ts) at true size, scaled up
// mildly in the mid band.
const LENGTH_M = 30
const RADIUS_M = 5
const LIFT_M = RADIUS_M + 1
const MODEL_Y_M = 0.1 // the ground (Ground.tsx); streets draw at 0.3 over it
const MAX_INSTANCES = 2048
const KINDS: VehicleKind[] = ['bus40', 'bus60', 'rail', 'cable']
// A long frame (tab switch, GC pause) shouldn't fling buses forward.
const MAX_DT_S = 0.1
// Trails (trails.ts) lie flat just above the streets, a little narrower than
// the vehicle at the head, and stay dim enough that only the vehicles glow.
// Under a model they drop to just over the streets and narrow to its width.
const TRAIL_HALF_WIDTH_M = 4
const TRAIL_Y_M = 1
const TRAIL_MODEL_Y_M = 0.45
const TRAIL_MODEL_WIDTH = 0.9 // of the model's width
const TRAIL_INTENSITY = 0.55

const COLOR_BY_TYPE: Record<number, Color> = {
  0: new Color(palette.muniRail),
  5: new Color(palette.muniCable),
}
const BUS_COLOR = new Color(palette.muniBus)
const STALE_COLOR = new Color(palette.muniStale)
// Cable car models glow warm lamp light, not their marker's pink.
const CABLE_LAMP = new Color(palette.cableLamp)
// A fully stale bus takes STALE_COLOR exactly. Mixing in linear light keeps
// every step between a live color and it above the streets' luminance.
const STALE_MIX = 1
// Fresh markers are drawn this many times brighter than their palette color,
// past the bloom threshold (App.tsx), so they glow and nothing else in the
// scene does. The boost fades out with staleness: a stale bus doesn't glow.
// Raised from the dusk-era 2.4: against a bright daylight sky/ground
// (skyBackground.ts, the lighter palette.ts pass) buses need more separation
// to still read as the brightest, most saturated things in frame.
const GLOW = 3.4
// A model's accent band and lamps: emission on top of their lit color, just
// past the bloom threshold, so a live model still pops but subtly.
const BAND_GLOW = 1.4
// However far the camera pulls back, a marker stays at least this wide on screen.
const MIN_WIDTH_PX = 4
const VISIBLE = 0.001

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

interface ModelSlot {
  geometry: BufferGeometry
  tint: InstancedBufferAttribute
  fx: InstancedBufferAttribute
}

export function Vehicles({ state }: { state: CurrentState | null }) {
  const routes = useRoutes()
  const mesh = useRef<InstancedMesh>(null)
  const modelMeshes = useRef<Partial<Record<VehicleKind, InstancedMesh | null>>>({})
  const motions = useRef(new Map<string, Motion>())
  // Buses that dropped out of current_state, fading out since `since` (s, performance clock).
  const leaving = useRef(new Map<string, { m: Motion; since: number }>())
  // Displayed heading per vehicle, eased toward the route's (lod.ts turnToward).
  const yaws = useRef(new Map<string, number>())
  const offsetMs = useRef(0)

  const geometry = useMemo(() => {
    const g = new CapsuleGeometry(RADIUS_M, LENGTH_M - 2 * RADIUS_M, 4, 8)
    g.rotateZ(Math.PI / 2) // long axis along +x, then each instance turns to its heading
    return g
  }, [])
  const material = useMemo(() => new MeshBasicMaterial({ toneMapped: false }), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  // One instanced mesh per model, each with its own per-instance tint and
  // staleness/glow (vehicleModels.ts vehicleMaterial).
  const models = useMemo(() => {
    const out = {} as Record<VehicleKind, ModelSlot>
    for (const kind of KINDS) {
      const g = buildVehicleGeometry(kind)
      const tint = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 3), 3).setUsage(DynamicDrawUsage)
      const fx = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES * 2), 2).setUsage(DynamicDrawUsage)
      g.setAttribute('aTint', tint)
      g.setAttribute('aFx', fx)
      out[kind] = { geometry: g, tint, fx }
    }
    return out
  }, [])
  const modelMaterial = useMemo(() => vehicleMaterial(), [])
  useEffect(() => () => KINDS.forEach((k) => models[k].geometry.dispose()), [models])
  useEffect(() => () => modelMaterial.dispose(), [modelMaterial])

  // One merged ribbon mesh for every trail, rewritten each frame.
  const trails = useMemo(() => {
    const position = new Float32Array(MAX_INSTANCES * TRAIL_VERTS_PER_SLOT * 3)
    const color = new Float32Array(position.length)
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(position, 3).setUsage(DynamicDrawUsage))
    g.setAttribute('color', new BufferAttribute(color, 3).setUsage(DynamicDrawUsage))
    g.setIndex(new BufferAttribute(trailIndex(MAX_INSTANCES), 1))
    g.setDrawRange(0, 0)
    return { geometry: g, out: { position, color } }
  }, [])
  const trailMaterial = useMemo(
    () =>
      new MeshBasicMaterial({
        vertexColors: true,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        toneMapped: false,
      }),
    [],
  )
  useEffect(() => () => trails.geometry.dispose(), [trails])
  useEffect(() => () => trailMaterial.dispose(), [trailMaterial])

  // A new read of current_state: update every bus, fade out the ones that left.
  useEffect(() => {
    if (!state) return
    offsetMs.current = state.serverOffsetMs
    const now = Date.now() + state.serverOffsetMs
    const seen = new Set<string>()
    for (const r of state.vehicles) {
      seen.add(r.id)
      const lines = r.routeId ? routes.index.get(r.routeId) : undefined
      const m = motions.current.get(r.id)
      if (m) applyReport(m, r, lines, now)
      else {
        motions.current.set(r.id, createMotion(r, lines, now))
        leaving.current.delete(r.id)
      }
    }
    for (const [id, m] of motions.current)
      if (!seen.has(id)) {
        motions.current.delete(id)
        leaving.current.set(id, { m, since: performance.now() / 1000 })
      }
  }, [state, routes])

  const dummy = useMemo(() => new Object3D(), [])
  const scratch = useMemo(() => new Color(), [])
  // setColorAt copies, so one scratch Color serves every instance.
  const glowScratch = useMemo(() => new Color(), [])
  const tintScratch = useMemo(() => new Color(), [])
  const routeType = (m: Motion) => (m.routeId !== null ? routes.typeByRoute.get(m.routeId) : undefined)
  // The palette color, moved toward STALE_COLOR as the bus's data ages.
  const colorFor = (m: Motion, dim: number) => {
    const base = COLOR_BY_TYPE[routeType(m) ?? 3] ?? BUS_COLOR
    return dim > 0 ? scratch.copy(base).lerp(STALE_COLOR, STALE_MIX * dim) : base
  }
  const glowing = (color: Color, dim: number) => glowScratch.copy(color).multiplyScalar(1 + (GLOW - 1) * (1 - dim))

  useFrame((frame, delta) => {
    const im = mesh.current
    if (!im) return
    const dt = Math.min(delta, MAX_DT_S)
    const now = Date.now() + offsetMs.current
    const camera = frame.camera as PerspectiveCamera
    const cam = camera.position
    const heightPx = frame.size.height
    const distance = (x: number, y: number, z: number) => Math.hypot(x - cam.x, y - cam.y, z - cam.z)
    // Scale-up that keeps a marker at (x, z) at least MIN_WIDTH_PX wide.
    const pxScale = (x: number, z: number) => minPixelScale(2 * RADIUS_M, MIN_WIDTH_PX, distance(x, LIFT_M, z), camera.fov, heightPx)
    const lodAt = (kind: VehicleKind, x: number, z: number) =>
      lodFor(lengthPx(MODEL_LENGTH_M[kind], distance(x, MODEL_Y_M + 1.5, z), camera.fov, heightPx))

    let n = 0
    const counts: Record<VehicleKind, number> = { bus40: 0, bus60: 0, rail: 0, cable: 0 }
    // One vehicle at (x, z) facing `yaw`: `scale` 0..1 for fades, its
    // (stale-faded) palette color, and its staleness.
    const put = (kind: VehicleKind, x: number, z: number, yaw: number, scale: number, color: Color, dim: number) => {
      if (scale <= VISIBLE) return
      const lod = lodAt(kind, x, z)
      if (lod.marker * scale > VISIBLE && n < MAX_INSTANCES) {
        dummy.position.set(x, LIFT_M, z)
        dummy.rotation.set(0, yaw, 0)
        dummy.scale.setScalar(scale * lod.marker * pxScale(x, z))
        dummy.updateMatrix()
        im.setMatrixAt(n, dummy.matrix)
        im.setColorAt(n, glowing(color, dim))
        n++
      }
      const mm = modelMeshes.current[kind]
      const i = counts[kind]
      if (mm && lod.model * scale > VISIBLE && i < MAX_INSTANCES) {
        dummy.position.set(x, MODEL_Y_M, z)
        dummy.rotation.set(0, yaw, 0)
        dummy.scale.setScalar(scale * lod.model * lod.modelScale)
        dummy.updateMatrix()
        mm.setMatrixAt(i, dummy.matrix)
        const tint = kind === 'cable' ? tintScratch.copy(CABLE_LAMP).lerp(STALE_COLOR, STALE_MIX * dim) : color
        models[kind].tint.setXYZ(i, tint.r, tint.g, tint.b)
        models[kind].fx.setXY(i, dim, BAND_GLOW * (1 - dim))
        counts[kind] = i + 1
      }
    }
    const yawOf = (id: string, hx: number, hz: number) => {
      const target = Math.atan2(-hz, hx)
      const prev = yaws.current.get(id)
      const yaw = prev === undefined ? target : turnToward(prev, target, dt)
      yaws.current.set(id, yaw)
      return yaw
    }

    let nt = 0
    for (const m of motions.current.values()) {
      step(m, now, dt)
      const kind = vehicleKind(routeType(m), m.id)
      const dim = staleDim(now - m.plan.tB)
      const color = colorFor(m, dim)
      // Only on route, and only with the speed measured on this shape. A stale
      // bus is frozen, so its trail fades out as it dims. Trails take the
      // unboosted color so they stay under the bloom threshold.
      if (nt < MAX_INSTANCES && m.line && m.line === m.plan.line) {
        const lod = lodAt(kind, m.x, m.z)
        const intensity = TRAIL_INTENSITY * smooth(m.appear) * (1 - dim)
        const halfWidth =
          lod.marker * TRAIL_HALF_WIDTH_M * pxScale(m.x, m.z) + lod.model * 0.5 * TRAIL_MODEL_WIDTH * MODEL_WIDTH_M[kind] * lod.modelScale
        const y = lod.marker * TRAIL_Y_M + lod.model * TRAIL_MODEL_Y_M
        if (writeTrail(trails.out, nt, m.line, m.s, trailLength(m.plan.v), halfWidth, y, color, intensity)) nt++
      }
      put(kind, m.x, m.z, yawOf(m.id, m.hx, m.hz), smooth(m.appear), color, dim)
      if (m.ghost) put(kind, m.ghost.x, m.ghost.z, Math.atan2(-m.ghost.hz, m.ghost.hx), 1 - smooth(m.ghost.age / FADE_S), color, dim)
    }
    const clock = performance.now() / 1000
    for (const [id, l] of leaving.current) {
      const age = clock - l.since
      if (age >= FADE_S) {
        leaving.current.delete(id)
        if (!motions.current.has(id)) yaws.current.delete(id)
      } else {
        const dim = staleDim(now - l.m.plan.tB)
        const yaw = yaws.current.get(id) ?? Math.atan2(-l.m.hz, l.m.hx)
        put(vehicleKind(routeType(l.m), id), l.m.x, l.m.z, yaw, 1 - smooth(age / FADE_S), colorFor(l.m, dim), dim)
      }
    }

    im.count = n
    im.instanceMatrix.needsUpdate = true
    if (im.instanceColor) im.instanceColor.needsUpdate = true
    for (const kind of KINDS) {
      const mm = modelMeshes.current[kind]
      if (!mm) continue
      const c = counts[kind]
      mm.count = c
      for (const attr of [mm.instanceMatrix, models[kind].tint, models[kind].fx]) {
        attr.clearUpdateRanges()
        attr.addUpdateRange(0, c * attr.itemSize)
        attr.needsUpdate = true
      }
    }

    const tg = trails.geometry
    tg.setDrawRange(0, nt * TRAIL_INDICES_PER_SLOT)
    for (const name of ['position', 'color'] as const) {
      const attr = tg.getAttribute(name) as BufferAttribute
      attr.clearUpdateRanges()
      attr.addUpdateRange(0, nt * TRAIL_VERTS_PER_SLOT * 3)
      attr.needsUpdate = true
    }
  })

  // Instances and trails span the whole city; their geometry's own bounds would cull them.
  return (
    <>
      <mesh geometry={trails.geometry} material={trailMaterial} frustumCulled={false} />
      <instancedMesh ref={mesh} args={[geometry, material, MAX_INSTANCES]} frustumCulled={false} />
      {KINDS.map((kind) => (
        <instancedMesh
          key={kind}
          ref={(el) => {
            modelMeshes.current[kind] = el
          }}
          args={[models[kind].geometry, modelMaterial, MAX_INSTANCES]}
          count={0}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
      ))}
    </>
  )
}
