import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stats } from '@react-three/drei'
import { Buildings } from './city/Buildings.tsx'

export default function App() {
  return (
    <Canvas camera={{ position: [0, 2500, 3500], fov: 40, near: 10, far: 20000 }}>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2000, 4000, 1000]} intensity={1.5} />
      <Suspense fallback={null}>
        <Buildings />
      </Suspense>
      <OrbitControls />
      <Stats />
    </Canvas>
  )
}
