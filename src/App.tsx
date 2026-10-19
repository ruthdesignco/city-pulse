import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Stats } from '@react-three/drei'
import { Bloom, EffectComposer, SSAO, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { Buildings } from './city/Buildings.tsx'
import { DEMO, REPLAY, REPLAY_HOLD_S, REPLAY_START_S } from './params.ts'
import { Ground } from './city/Ground.tsx'
import { Streets } from './city/Streets.tsx'
import { Atmosphere } from './scene/Atmosphere.tsx'
import { CameraRig } from './scene/CameraRig.tsx'
import { OPENING_POSITION } from './scene/view.ts'
import { Freshness } from './transit/Freshness.tsx'
import { RecordedBadge } from './transit/RecordedBadge.tsx'
import { Vehicles } from './transit/Vehicles.tsx'
import { useCurrentState } from './transit/useCurrentState.ts'
import { type ReplayStatus, useRecordedState } from './transit/useRecordedState.ts'
import { WebGLGate } from './scene/WebGLGate.tsx'

// The live feed, or ?replay=<name>'s recording. Chosen once per page load, so
// the hooks called never change between renders.
const REPLAY_OPTIONS = { startS: REPLAY_START_S, holdS: REPLAY_HOLD_S }
const replayName = REPLAY
const useFeed: () => ReturnType<typeof useCurrentState> & { replay: ReplayStatus | null } =
  replayName !== null ? () => useRecordedState(replayName, REPLAY_OPTIONS) : () => ({ ...useCurrentState(), replay: null })

// In demo mode, `h` hides the overlay for shots that should show only the city.
function useOverlayToggle(): boolean {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    if (!DEMO) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'h' && !e.metaKey && !e.ctrlKey && !e.altKey) setHidden((h) => !h)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return hidden
}

export default function App() {
  const feed = useFeed()
  const overlayHidden = useOverlayToggle()
  return (
    <WebGLGate>
      {/* The bloom composer renders the whole scene again into a 4x
          multisampled half-float buffer, so pixel count is the frame cost:
          cap the pixel ratio at 1.5 (44% fewer pixels than 2 on Retina) and
          skip the canvas's own antialiasing, which the composer replaces. */}
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: false }}
        // "soft" (PCFSoft) was removed in this three.js version -- it falls
        // back to hard PCF with a console warning. VSM is the remaining
        // soft-shadow type (Atmosphere.tsx's shadow-radius controls blur).
        shadows="variance"
        camera={{ position: OPENING_POSITION, fov: 40, near: 10, far: 20000 }}
      >
        {/* Each independently-loading resource (HDRI, city.bin, routes.json)
            gets its own Suspense boundary. Sharing one boundary across
            siblings suspending on different promises that resolve at
            different real times makes React discard and remount the WHOLE
            subtree every time any one of them resolves -- Buildings' city
            geometry was extruding 4 times on a single page load because of
            this, not twice (React StrictMode's expected dev-only double
            render). */}
        <Suspense fallback={null}>
          <Atmosphere />
        </Suspense>
        <Suspense fallback={null}>
          <Ground />
          <Streets />
          <Buildings />
        </Suspense>
        <Suspense fallback={null}>
          {/* A looping recording restarts its clock: start the buses fresh. */}
          <Vehicles key={feed.replay?.loop ?? 0} state={feed.state} />
        </Suspense>
        <CameraRig />
        {/* Only the buses are bright enough to bloom (Vehicles.tsx, GLOW).
            The composer turns off the renderer's tone mapping, so it's
            reapplied here as the same ACES curve, after the bloom. SSAO runs
            first: soft contact shadows in corners and at street level, subtle
            enough not to compete with the real shadows from Atmosphere's sun. */}
        <EffectComposer enableNormalPass>
          <SSAO radius={0.12} intensity={12} luminanceInfluence={0.6} distanceFalloff={0.5} />
          <Bloom luminanceThreshold={0.9} luminanceSmoothing={0.2} intensity={1.1} mipmapBlur />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
        {import.meta.env.DEV && !DEMO && <Stats />}
      </Canvas>
      {!overlayHidden && <Freshness feed={feed} />}
      {feed.replay && <RecordedBadge replay={feed.replay} />}
    </WebGLGate>
  )
}
