import { PerformanceMonitor } from '@react-three/drei'
import { useEffect, useState } from 'react'
import { DECLINE_BELOW_FPS, MONITOR_WARMUP_MS } from './quality.ts'

// Watches the frame rate (inside the Canvas) and calls onDecline when it
// stays below DECLINE_BELOW_FPS (quality.ts). Starts after a warm-up so
// load-time hitches don't count; App remounts it after every step, since
// the step itself (a composer or shadow map rebuilt) hitches too.
export function QualityMonitor({ onDecline }: { onDecline: () => void }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setReady(true), MONITOR_WARMUP_MS)
    return () => clearTimeout(t)
  }, [])
  if (!ready) return null
  return <PerformanceMonitor bounds={() => [DECLINE_BELOW_FPS, Number.POSITIVE_INFINITY]} onDecline={onDecline} />
}
