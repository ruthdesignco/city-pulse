import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { CapsuleGeometry, Color, type InstancedMesh, MeshBasicMaterial, Object3D } from 'three'
import { palette } from '../city/palette.ts'
import type { CurrentState } from './currentState.ts'
import { FADE_S, type Motion, applyReport, createMotion, step } from './motion.ts'
import { useRoutes } from './useRoutes.ts'

// Drawn larger than life (a bus is 12-18 m) so it reads from the orbit
// camera, 800-6500 m out.
const LENGTH_M = 30
const RADIUS_M = 5
const LIFT_M = RADIUS_M + 1
const MAX_INSTANCES = 2048
// A long frame (tab switch, GC pause) shouldn't fling buses forward.
const MAX_DT_S = 0.1

const COLOR_BY_TYPE: Record<number, Color> = {
  0: new Color(palette.muniRail),
  5: new Color(palette.muniCable),
}
const BUS_COLOR = new Color(palette.muniBus)

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}

export function Vehicles({ state }: { state: CurrentState | null }) {
  const routes = useRoutes()
  const mesh = useRef<InstancedMesh>(null)
  const motions = useRef(new Map<string, Motion>())
  // Buses that dropped out of current_state, fading out since `since` (s, performance clock).
  const leaving = useRef(new Map<string, { m: Motion; since: number }>())
  const offsetMs = useRef(0)

  const geometry = useMemo(() => {
    const g = new CapsuleGeometry(RADIUS_M, LENGTH_M - 2 * RADIUS_M, 4, 8)
    g.rotateZ(Math.PI / 2) // long axis along +x, then each instance turns to its heading
    return g
  }, [])
  const material = useMemo(() => new MeshBasicMaterial({ toneMapped: false }), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

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
  const colorFor = (m: Motion) => (m.routeId !== null ? COLOR_BY_TYPE[routes.typeByRoute.get(m.routeId) ?? 3] : undefined) ?? BUS_COLOR

  useFrame((_, delta) => {
    const im = mesh.current
    if (!im) return
    const dt = Math.min(delta, MAX_DT_S)
    const now = Date.now() + offsetMs.current
    let n = 0
    const put = (x: number, z: number, hx: number, hz: number, scale: number, color: Color) => {
      if (n >= MAX_INSTANCES || scale <= 0.001) return
      dummy.position.set(x, LIFT_M, z)
      dummy.rotation.set(0, Math.atan2(-hz, hx), 0)
      dummy.scale.setScalar(scale)
      dummy.updateMatrix()
      im.setMatrixAt(n, dummy.matrix)
      im.setColorAt(n, color)
      n++
    }

    for (const m of motions.current.values()) {
      step(m, now, dt)
      const color = colorFor(m)
      put(m.x, m.z, m.hx, m.hz, smooth(m.appear), color)
      if (m.ghost) put(m.ghost.x, m.ghost.z, m.ghost.hx, m.ghost.hz, 1 - smooth(m.ghost.age / FADE_S), color)
    }
    const clock = performance.now() / 1000
    for (const [id, l] of leaving.current) {
      const age = clock - l.since
      if (age >= FADE_S) leaving.current.delete(id)
      else put(l.m.x, l.m.z, l.m.hx, l.m.hz, 1 - smooth(age / FADE_S), colorFor(l.m))
    }

    im.count = n
    im.instanceMatrix.needsUpdate = true
    if (im.instanceColor) im.instanceColor.needsUpdate = true
  })

  // Instances span the whole city; the geometry's own bounds would cull them.
  return <instancedMesh ref={mesh} args={[geometry, material, MAX_INSTANCES]} frustumCulled={false} />
}
