import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import {
  AdditiveBlending,
  type BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  type InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  type PerspectiveCamera,
  PlaneGeometry,
  Vector3,
} from 'three'
import { DEMO } from '../params.ts'
import type { CurrentState } from './currentState.ts'
import { type VehicleKind, vehicleKind } from './fleet.ts'
import { staleDim } from './freshness.ts'
import { lengthPx, modelScale, turnToward } from './lod.ts'
import { FADE_S, type Motion } from './motion.ts'
import type { Pose } from './spacing.ts'
import { Traffic } from './traffic.ts'
import { useRoutes } from './useRoutes.ts'
import { MODEL_LENGTH_M, MODEL_WIDTH_M, buildVehicleGeometry, vehicleMaterial } from './vehicleModels.ts'

// Every vehicle is its low poly model (vehicleModels.ts), sun lit, in its
// real body colors: true size up close, scaled up to 3x with distance so it
// stays findable from the opening view (lod.ts). No glow, no trails. Each
// drives in its lane, kept clear of the others (traffic.ts). A Muni Metro
// train in the subway isn't drawn on the street: it sinks out of sight at
// the portal and a faint marker the shape of the train glides along the
// street above it instead (MARKER_*). The F's streetcars stay on the surface.
const MODEL_Y_M = 0.25 // on the asphalt (Streets.tsx)
const MAX_INSTANCES = 2048
const KINDS: VehicleKind[] = ['bus40', 'bus60', 'rail', 'cable']
// The subway marker: an additive tint over the street, so it fades to
// nothing rather than to a dark patch; how far a train sinks out of sight
// at a portal, and how long it takes.
const MARKER_COLOR = new Color('#3a4a5c')
const MARKER_Y_M = 0.4 // over the asphalt and its markings (Streets.tsx)
const SINK_M = 6
const SINK_S = 1
// A long frame (tab switch, GC pause) shouldn't fling buses forward.
const MAX_DT_S = 0.1
// In ?demo, how many vehicles sit inside this central part of the frame
// (normalized device coordinates) goes to window.__vehiclesInView, so
// scripts/shot.ts can wait for a frame that actually shows some.
const IN_VIEW_NDC = 0.8

declare global {
  interface Window {
    __vehiclesInView?: number
  }
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

interface ModelSlot {
  geometry: BufferGeometry
  stale: InstancedBufferAttribute
}

export function Vehicles({ state }: { state: CurrentState | null }) {
  const routes = useRoutes()
  const meshes = useRef<Partial<Record<VehicleKind, InstancedMesh | null>>>({})
  const traffic = useRef(new Traffic())
  // Vehicles that dropped out of current_state, shrinking away since `since`
  // (s, performance clock) where they were last drawn.
  const leaving = useRef(new Map<string, { m: Motion; since: number; pose: Pose | undefined }>())
  // Where each vehicle was drawn last frame: where it leaves from, and
  // where a re-snapped one's fading ghost stays (motion.ts resnap).
  const lastPose = useRef(new Map<string, Pose>())
  const ghostPose = useRef(new Map<string, Pose>())
  // Displayed heading per vehicle, eased toward the route's (lod.ts turnToward).
  const yaws = useRef(new Map<string, number>())
  // How far into the subway each Metro train is, 0 on the street .. 1 under it.
  const under = useRef(new Map<string, number>())
  const markers = useRef<InstancedMesh | null>(null)
  const marker = useMemo(() => {
    const geometry = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
    const material = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: true,
      // Over the streets, which are pulled toward the camera themselves.
      polygonOffset: true,
      polygonOffsetFactor: -8,
      polygonOffsetUnits: -8,
    })
    return { geometry, material }
  }, [])
  useEffect(() => () => {
    marker.geometry.dispose()
    marker.material.dispose()
  }, [marker])
  const offsetMs = useRef(0)

  // One instanced mesh per model, each with its own per-instance staleness
  // (vehicleModels.ts vehicleMaterial).
  const models = useMemo(() => {
    const out = {} as Record<VehicleKind, ModelSlot>
    for (const kind of KINDS) {
      const geometry = buildVehicleGeometry(kind)
      const stale = new InstancedBufferAttribute(new Float32Array(MAX_INSTANCES), 1).setUsage(DynamicDrawUsage)
      geometry.setAttribute('aStale', stale)
      out[kind] = { geometry, stale }
    }
    return out
  }, [])
  const material = useMemo(() => vehicleMaterial(), [])
  useEffect(() => () => KINDS.forEach((k) => models[k].geometry.dispose()), [models])
  useEffect(() => () => material.dispose(), [material])

  // A new read of current_state: update every vehicle, fade out the ones that left.
  useEffect(() => {
    if (!state) return
    offsetMs.current = state.serverOffsetMs
    const now = Date.now() + state.serverOffsetMs
    for (const r of state.vehicles) leaving.current.delete(r.id)
    for (const m of traffic.current.apply(state, routes.index, now))
      leaving.current.set(m.id, { m, since: performance.now() / 1000, pose: lastPose.current.get(m.id) })
  }, [state, routes])

  const dummy = useMemo(() => new Object3D(), [])
  const ndc = useMemo(() => new Vector3(), [])
  const routeType = (m: Motion) => (m.routeId !== null ? routes.typeByRoute.get(m.routeId) : undefined)

  useFrame((frame, delta) => {
    const dt = Math.min(delta, MAX_DT_S)
    const now = Date.now() + offsetMs.current
    const camera = frame.camera as PerspectiveCamera
    const cam = camera.position
    const heightPx = frame.size.height
    const counts: Record<VehicleKind, number> = { bus40: 0, bus60: 0, rail: 0, cable: 0 }
    let inView = 0

    // One vehicle at (x, z) facing `yaw`, `fade` 0..1 for appearing and
    // leaving, `stale` 0..1.
    // How much larger than life a vehicle is drawn where it stands (lod.ts).
    const scaleAt = (kind: VehicleKind, x: number, z: number) =>
      modelScale(lengthPx(MODEL_LENGTH_M[kind], Math.hypot(x - cam.x, MODEL_Y_M + 1.5 - cam.y, z - cam.z), camera.fov, heightPx))
    let markerCount = 0
    const tint = new Color()
    // A subway train's marker, `amount` 0..1 of its full tint.
    const putMarker = (kind: VehicleKind, x: number, z: number, yaw: number, amount: number) => {
      const mesh = markers.current
      if (!mesh || amount <= 0.001 || markerCount >= MAX_INSTANCES) return
      const scale = scaleAt(kind, x, z)
      dummy.position.set(x, MARKER_Y_M, z)
      dummy.rotation.set(0, yaw, 0)
      dummy.scale.set(MODEL_LENGTH_M[kind] * scale, 1, MODEL_WIDTH_M[kind] * scale)
      dummy.updateMatrix()
      mesh.setMatrixAt(markerCount, dummy.matrix)
      mesh.setColorAt(markerCount, tint.copy(MARKER_COLOR).multiplyScalar(amount))
      markerCount++
    }
    const put = (kind: VehicleKind, x: number, z: number, yaw: number, fade: number, stale: number, sink = 0) => {
      const mesh = meshes.current[kind]
      const i = counts[kind]
      if (!mesh || fade <= 0.001 || sink >= 0.999 || i >= MAX_INSTANCES) return
      dummy.position.set(x, MODEL_Y_M - SINK_M * sink * sink, z)
      dummy.rotation.set(0, yaw, 0)
      dummy.scale.setScalar(fade * scaleAt(kind, x, z))
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
      models[kind].stale.setX(i, stale)
      counts[kind] = i + 1
      if (DEMO && fade >= 1) {
        ndc.set(x, MODEL_Y_M, z).project(camera)
        if (ndc.z < 1 && Math.abs(ndc.x) < IN_VIEW_NDC && Math.abs(ndc.y) < IN_VIEW_NDC) inView++
      }
    }
    const yawOf = (id: string, hx: number, hz: number) => {
      const target = Math.atan2(-hz, hx)
      const prev = yaws.current.get(id)
      const yaw = prev === undefined ? target : turnToward(prev, target, dt)
      yaws.current.set(id, yaw)
      return yaw
    }

    for (const { m, kind, pose, underground } of traffic.current.frame(now, dt, (m) => vehicleKind(routeType(m), m.id), scaleAt)) {
      const stale = staleDim(now - m.plan.tB)
      const was = under.current.get(m.id) ?? (underground ? 1 : 0)
      const u = Math.min(1, Math.max(0, was + (underground ? 1 : -1) * (dt / SINK_S)))
      if (u > 0) under.current.set(m.id, u)
      else under.current.delete(m.id)
      const yaw = yawOf(m.id, pose.hx, pose.hz)
      put(kind, pose.x, pose.z, yaw, smooth(m.appear), stale, smooth(u))
      putMarker(kind, pose.x, pose.z, yaw, smooth(m.appear) * smooth(u))
      if (m.ghost) {
        // The ghost stays where the vehicle was drawn when it re-snapped.
        const g = ghostPose.current.get(m.id) ?? lastPose.current.get(m.id) ?? { x: m.ghost.x, z: m.ghost.z, hx: m.ghost.hx, hz: m.ghost.hz }
        ghostPose.current.set(m.id, g)
        const fade = 1 - smooth(m.ghost.age / FADE_S)
        put(kind, g.x, g.z, Math.atan2(-g.hz, g.hx), fade, stale, smooth(u))
        putMarker(kind, g.x, g.z, Math.atan2(-g.hz, g.hx), fade * smooth(u))
      } else ghostPose.current.delete(m.id)
      lastPose.current.set(m.id, pose)
    }
    const clock = performance.now() / 1000
    for (const [id, l] of leaving.current) {
      const age = clock - l.since
      if (age >= FADE_S) {
        leaving.current.delete(id)
        if (!traffic.current.motions.has(id)) {
          yaws.current.delete(id)
          under.current.delete(id)
          lastPose.current.delete(id)
          ghostPose.current.delete(id)
        }
      } else {
        const yaw = yaws.current.get(id) ?? Math.atan2(-l.m.hz, l.m.hx)
        const p = l.pose ?? { x: l.m.x, z: l.m.z }
        const kind = vehicleKind(routeType(l.m), id)
        const u = smooth(under.current.get(id) ?? 0)
        put(kind, p.x, p.z, yaw, 1 - smooth(age / FADE_S), staleDim(now - l.m.plan.tB), u)
        putMarker(kind, p.x, p.z, yaw, (1 - smooth(age / FADE_S)) * u)
      }
    }

    if (markers.current) {
      const mesh = markers.current
      mesh.count = markerCount
      mesh.instanceMatrix.clearUpdateRanges()
      mesh.instanceMatrix.addUpdateRange(0, markerCount * 16)
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    if (DEMO) window.__vehiclesInView = inView
    for (const kind of KINDS) {
      const mesh = meshes.current[kind]
      if (!mesh) continue
      const c = counts[kind]
      mesh.count = c
      for (const attr of [mesh.instanceMatrix, models[kind].stale]) {
        attr.clearUpdateRanges()
        attr.addUpdateRange(0, c * attr.itemSize)
        attr.needsUpdate = true
      }
    }
  })

  // Instances span the whole city; the model geometry's own bounds would cull
  // them. Too small to matter in the Bay's reflection (BayWater.tsx).
  return (
    <>
      {KINDS.map((kind) => (
        <instancedMesh
          key={kind}
          ref={(el) => {
            meshes.current[kind] = el
          }}
          args={[models[kind].geometry, material, MAX_INSTANCES]}
          count={0}
          frustumCulled={false}
          castShadow
          receiveShadow
          userData={{ noReflect: true }}
        />
      ))}
      <instancedMesh
        ref={(el) => {
          markers.current = el
          // Allocate per-instance colors up front.
          if (el && !el.instanceColor) el.setColorAt(0, new Color(0, 0, 0))
        }}
        args={[marker.geometry, marker.material, MAX_INSTANCES]}
        count={0}
        frustumCulled={false}
        renderOrder={1}
        userData={{ noReflect: true }}
      />
    </>
  )
}
