import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { type BufferGeometry, DynamicDrawUsage, InstancedBufferAttribute, type InstancedMesh, Object3D, type PerspectiveCamera, Vector3 } from 'three'
import { DEMO } from '../params.ts'
import type { CurrentState } from './currentState.ts'
import { type VehicleKind, vehicleKind } from './fleet.ts'
import { staleDim } from './freshness.ts'
import { lengthPx, modelScale, turnToward } from './lod.ts'
import { FADE_S, type Motion, applyReport, createMotion, step } from './motion.ts'
import { useRoutes } from './useRoutes.ts'
import { MODEL_LENGTH_M, buildVehicleGeometry, vehicleMaterial } from './vehicleModels.ts'

// Every vehicle is its low poly model (vehicleModels.ts), sun lit, in its
// real body colors: true size up close, scaled up to 3x with distance so it
// stays findable from the opening view (lod.ts). No glow, no trails.
const MODEL_Y_M = 0.25 // on the asphalt (Streets.tsx)
const MAX_INSTANCES = 2048
const KINDS: VehicleKind[] = ['bus40', 'bus60', 'rail', 'cable']
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
  const motions = useRef(new Map<string, Motion>())
  // Vehicles that dropped out of current_state, shrinking away since `since` (s, performance clock).
  const leaving = useRef(new Map<string, { m: Motion; since: number }>())
  // Displayed heading per vehicle, eased toward the route's (lod.ts turnToward).
  const yaws = useRef(new Map<string, number>())
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
    const put = (kind: VehicleKind, x: number, z: number, yaw: number, fade: number, stale: number) => {
      const mesh = meshes.current[kind]
      const i = counts[kind]
      if (!mesh || fade <= 0.001 || i >= MAX_INSTANCES) return
      const distance = Math.hypot(x - cam.x, MODEL_Y_M + 1.5 - cam.y, z - cam.z)
      dummy.position.set(x, MODEL_Y_M, z)
      dummy.rotation.set(0, yaw, 0)
      dummy.scale.setScalar(fade * modelScale(lengthPx(MODEL_LENGTH_M[kind], distance, camera.fov, heightPx)))
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

    for (const m of motions.current.values()) {
      step(m, now, dt)
      const kind = vehicleKind(routeType(m), m.id)
      const stale = staleDim(now - m.plan.tB)
      put(kind, m.x, m.z, yawOf(m.id, m.hx, m.hz), smooth(m.appear), stale)
      if (m.ghost) put(kind, m.ghost.x, m.ghost.z, Math.atan2(-m.ghost.hz, m.ghost.hx), 1 - smooth(m.ghost.age / FADE_S), stale)
    }
    const clock = performance.now() / 1000
    for (const [id, l] of leaving.current) {
      const age = clock - l.since
      if (age >= FADE_S) {
        leaving.current.delete(id)
        if (!motions.current.has(id)) yaws.current.delete(id)
      } else {
        const yaw = yaws.current.get(id) ?? Math.atan2(-l.m.hz, l.m.hx)
        put(vehicleKind(routeType(l.m), id), l.m.x, l.m.z, yaw, 1 - smooth(age / FADE_S), staleDim(now - l.m.plan.tB))
      }
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
    </>
  )
}
