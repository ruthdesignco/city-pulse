import { type ComponentRef, useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { TARGET } from './view.ts'

// Constrained orbit around the cluster plus a slow idle drift.
const MIN_DISTANCE = 800
const MAX_DISTANCE = 6500
const MIN_POLAR = 0.15 // near top-down
const MAX_POLAR = 1.15 // ~66° from vertical: never at or below the horizon

const DRIFT_RAD_PER_S = (2 * Math.PI) / 240 // one orbit every 4 minutes
const IDLE_BEFORE_DRIFT_MS = 4000
const DRIFT_EASE_IN_MS = 2000

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function CameraRig() {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const interacting = useRef(false)
  const lastInteraction = useRef(0)
  const reducedMotion = useRef(true)

  useEffect(() => {
    lastInteraction.current = performance.now() // count the first idle period from mount
    reducedMotion.current = prefersReducedMotion()
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => (reducedMotion.current = query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  // Drift is driven by frame delta, so it runs at the same speed at 60 or
  // 120 Hz, and eases in after the user lets go instead of snapping.
  useFrame((_, delta) => {
    const c = controls.current
    if (!c || interacting.current || reducedMotion.current) return
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
      target={TARGET}
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      rotateSpeed={0.6}
      zoomSpeed={0.8}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      minPolarAngle={MIN_POLAR}
      maxPolarAngle={MAX_POLAR}
      onStart={() => {
        interacting.current = true
      }}
      onEnd={() => {
        interacting.current = false
        lastInteraction.current = performance.now()
      }}
    />
  )
}
