import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Stats } from '@react-three/drei'
import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing'
import { ToneMappingMode } from 'postprocessing'
import { Buildings } from './city/Buildings.tsx'
import { Ground } from './city/Ground.tsx'
import { Streets } from './city/Streets.tsx'
import { Atmosphere } from './scene/Atmosphere.tsx'
import { CameraRig } from './scene/CameraRig.tsx'
import { OPENING_POSITION } from './scene/view.ts'
import { Freshness } from './transit/Freshness.tsx'
import { Vehicles } from './transit/Vehicles.tsx'
import { useCurrentState } from './transit/useCurrentState.ts'

export default function App() {
  const feed = useCurrentState()
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
          <Vehicles state={feed.state} />
        </Suspense>
        <CameraRig />
        {/* Only the buses are bright enough to bloom (Vehicles.tsx, GLOW).
            The composer turns off the renderer's tone mapping, so it's
            reapplied here as the same ACES curve, after the bloom. */}
        <EffectComposer>
          <Bloom luminanceThreshold={1} luminanceSmoothing={0.2} intensity={0.9} mipmapBlur />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
        </EffectComposer>
        {import.meta.env.DEV && <Stats />}
      </Canvas>
      <Freshness feed={feed} />
    </>
  )
}
