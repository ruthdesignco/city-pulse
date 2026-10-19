import { type ComponentRef, useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { DEMO } from '../params.ts'
import { type Pose, SHOTS, type Shot, shotPose } from './shots.ts'
import { ORBIT_LIMITS } from './view.ts'

// Constrained orbit around the cluster (view.ts ORBIT_LIMITS) plus a slow
// idle drift, starting from `start` (the opening view or a ?view preset, App.tsx).

const DRIFT_RAD_PER_S = (2 * Math.PI) / 240 // one orbit every 4 minutes
const IDLE_BEFORE_DRIFT_MS = 4000
const DRIFT_EASE_IN_MS = 2000

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function CameraRig({ start }: { start: Pose }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const interacting = useRef(false)
  const lastInteraction = useRef(0)
  const reducedMotion = useRef(true)
  // The walkthrough shot playing, if any (?demo, keys 1-7; Esc or a drag stops it).
  const playing = useRef<{ shot: Shot; startedAt: number } | null>(null)

  useEffect(() => {
    lastInteraction.current = performance.now() // count the first idle period from mount
    reducedMotion.current = prefersReducedMotion()
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => (reducedMotion.current = query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (!DEMO) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        playing.current = null
        lastInteraction.current = performance.now()
        return
      }
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= SHOTS.length) playing.current = { shot: SHOTS[n - 1], startedAt: performance.now() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Drift is driven by frame delta, so it runs at the same speed at 60 or
  // 120 Hz, and eases in after the user lets go instead of snapping.
  useFrame((_, delta) => {
    const c = controls.current
    if (!c) return
    const p = playing.current
    if (p) {
      // A shot plays even with reduced motion: someone asked for it.
      const elapsedS = (performance.now() - p.startedAt) / 1000
      const pose = shotPose(p.shot, elapsedS)
      c.object.position.set(...pose.position)
      c.target.set(...pose.target)
      c.update()
      if (elapsedS >= p.shot.durationS) {
        playing.current = null
        lastInteraction.current = performance.now() // hold the end frame, then drift
      }
      return
    }
    if (interacting.current || reducedMotion.current) return
    const idle = performance.now() - lastInteraction.current - IDLE_BEFORE_DRIFT_MS
    if (idle <= 0) return
    const t = Math.min(1, idle / DRIFT_EASE_IN_MS)
    const ease = t * t * (3 - 2 * t)
    c.setAzimuthalAngle(c.getAzimuthalAngle() + DRIFT_RAD_PER_S * ease * Math.min(delta, 0.1))
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={start.target}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
      minDistance={ORBIT_LIMITS.minDistance}
      maxDistance={ORBIT_LIMITS.maxDistance}
      minPolarAngle={ORBIT_LIMITS.minPolar}
      maxPolarAngle={ORBIT_LIMITS.maxPolar}
      onStart={() => {
        interacting.current = true
        playing.current = null
      }}
      onEnd={() => {
        interacting.current = false
        lastInteraction.current = performance.now()
      }}
    />
  )
}
