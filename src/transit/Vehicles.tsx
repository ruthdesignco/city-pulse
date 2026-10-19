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
  type InstancedMesh,
  MeshBasicMaterial,
  Object3D,
} from 'three'
import { palette } from '../city/palette.ts'
import type { CurrentState } from './currentState.ts'
import { staleDim } from './freshness.ts'
import { FADE_S, type Motion, applyReport, createMotion, step } from './motion.ts'
import { TRAIL_INDICES_PER_SLOT, TRAIL_VERTS_PER_SLOT, trailIndex, trailLength, writeTrail } from './trails.ts'
import { useRoutes } from './useRoutes.ts'

// Drawn larger than life (a bus is 12-18 m) so it reads from the orbit
// camera, 800-6500 m out.
const LENGTH_M = 30
const RADIUS_M = 5
const LIFT_M = RADIUS_M + 1
const MAX_INSTANCES = 2048
// A long frame (tab switch, GC pause) shouldn't fling buses forward.
const MAX_DT_S = 0.1
// Trails (trails.ts) lie flat just above the streets, a little narrower than
// the bus at the head, and stay dim enough that only the buses themselves glow.
const TRAIL_HALF_WIDTH_M = 4
const TRAIL_Y_M = 1
const TRAIL_INTENSITY = 0.55

const COLOR_BY_TYPE: Record<number, Color> = {
  0: new Color(palette.muniRail),
  5: new Color(palette.muniCable),
}
const BUS_COLOR = new Color(palette.muniBus)
const STALE_COLOR = new Color(palette.muniStale)
const STALE_MIX = 0.8 // how far a fully stale bus moves toward STALE_COLOR

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
  const colorFor = (m: Motion, now: number) => {
    const base = (m.routeId !== null ? COLOR_BY_TYPE[routes.typeByRoute.get(m.routeId) ?? 3] : undefined) ?? BUS_COLOR
    const dim = staleDim(now - m.plan.tB)
    return dim > 0 ? scratch.copy(base).lerp(STALE_COLOR, STALE_MIX * dim) : base
  }

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

    let nt = 0
    for (const m of motions.current.values()) {
      step(m, now, dt)
      const color = colorFor(m, now)
      put(m.x, m.z, m.hx, m.hz, smooth(m.appear), color)
      if (m.ghost) put(m.ghost.x, m.ghost.z, m.ghost.hx, m.ghost.hz, 1 - smooth(m.ghost.age / FADE_S), color)
      // Only on route, and only with the speed measured on this shape. A stale
      // bus is frozen, so its trail fades out as it dims.
      if (nt < MAX_INSTANCES && m.line && m.line === m.plan.line) {
        const intensity = TRAIL_INTENSITY * smooth(m.appear) * (1 - staleDim(now - m.plan.tB))
        const length = trailLength(m.plan.v)
        if (writeTrail(trails.out, nt, m.line, m.s, length, TRAIL_HALF_WIDTH_M, TRAIL_Y_M, color, intensity)) nt++
      }
    }
    const clock = performance.now() / 1000
    for (const [id, l] of leaving.current) {
      const age = clock - l.since
      if (age >= FADE_S) leaving.current.delete(id)
      else put(l.m.x, l.m.z, l.m.hx, l.m.hz, 1 - smooth(age / FADE_S), colorFor(l.m, now))
    }

    im.count = n
    im.instanceMatrix.needsUpdate = true
    if (im.instanceColor) im.instanceColor.needsUpdate = true

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
    </>
  )
}
