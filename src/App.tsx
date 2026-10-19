import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stats } from '@react-three/drei'
import { Buildings } from './city/Buildings.tsx'
import { Ground } from './city/Ground.tsx'
import { Streets } from './city/Streets.tsx'
import { Atmosphere } from './scene/Atmosphere.tsx'

export default function App() {
  return (
    <Canvas camera={{ position: [0, 2500, 3500], fov: 40, near: 10, far: 20000 }}>
      <Atmosphere />
      <Suspense fallback={null}>
        <Ground />
        <Streets />
        <Buildings />
      </Suspense>
      <OrbitControls />
      {import.meta.env.DEV && <Stats />}
    </Canvas>
  )
}
