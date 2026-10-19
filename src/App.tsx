import { Suspense, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Stats } from '@react-three/drei'
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing'
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
    <>
      {/* The bloom composer renders the whole scene again into a 4x
          multisampled half-float buffer, so pixel count is the frame cost:
          cap the pixel ratio at 1.5 (44% fewer pixels than 2 on Retina) and
          skip the canvas's own antialiasing, which the composer replaces. */}
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: false }}
        camera={{ position: OPENING_POSITION, fov: 40, near: 10, far: 20000 }}
      >
        <Atmosphere />
        <Suspense fallback={null}>
          <Ground />
          <Streets />
          <Buildings />
          {/* A looping recording restarts its clock: start the buses fresh. */}
          <Vehicles key={feed.replay?.loop ?? 0} state={feed.state} />
        </Suspense>
        <CameraRig />
        {/* Only the buses are bright enough to bloom (Vehicles.tsx, GLOW).
            The composer turns off the renderer's tone mapping, so it's
            reapplied here as the same ACES curve, after the bloom. */}
        <EffectComposer>
          <Bloom luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.9} mipmapBlur />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
        {import.meta.env.DEV && !DEMO && <Stats />}
      </Canvas>
      {!overlayHidden && <Freshness feed={feed} />}
      {feed.replay && <RecordedBadge replay={feed.replay} />}
    </>
  )
}
