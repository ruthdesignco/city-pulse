import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Stats } from '@react-three/drei'
import { Buildings } from './city/Buildings.tsx'
import { Ground } from './city/Ground.tsx'
import { Streets } from './city/Streets.tsx'
import { Atmosphere } from './scene/Atmosphere.tsx'
import { CameraRig } from './scene/CameraRig.tsx'
import { Freshness } from './transit/Freshness.tsx'
import { Vehicles } from './transit/Vehicles.tsx'
import { useCurrentState } from './transit/useCurrentState.ts'

export default function App() {
  const feed = useCurrentState()
  return (
    <>
      <Canvas dpr={[1, 2]} camera={{ position: [0, 2500, 3500], fov: 40, near: 10, far: 20000 }}>
        <Atmosphere />
        <Suspense fallback={null}>
          <Ground />
          <Streets />
          <Buildings />
          <Vehicles state={feed.state} />
        </Suspense>
        <CameraRig />
        {import.meta.env.DEV && <Stats />}
      </Canvas>
      <Freshness feed={feed} />
    </>
  )
}
