import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Cloud, Clouds, Environment } from '@react-three/drei'
import type { Group } from 'three'
import { palette } from '../city/palette.ts'
import { createCloudTextureDataUrl } from './cloudTexture.ts'
import { SUN_POSITION } from './sun.ts'

// Daytime golden hour: a real HDRI (public/sky.hdr, Poly Haven CC0
// "belfast_sunset") drives both the visible sky and the scene's ambient
// lighting -- bright and warm, not the old dusk's dark navy. The
// directional light rides on top of that purely to cast real, crisp
// shadows from the same warm direction (sun.ts); it's not the scene's main
// light source anymore. Linear fog fades the context ring into a bright
// haze, not darkness.
//
// The shadow camera frustum is sized around the baked city, not the full
// 40,000 m ground plane (Ground.tsx) -- a low sun angle casts long shadows,
// so this errs wide rather than clipping them at the edge of view.
const SHADOW_EXTENT_M = 3600

// Clouds drift by slowly rotating the whole layer about the vertical axis --
// simpler than translating individual puffs and wrapping them at the edges,
// and reads the same from an orbiting camera. One full pass overhead takes
// about 20 minutes; "soft," not a time-lapse.
const CLOUD_HEIGHT_M = 2600
const CLOUD_DRIFT_RAD_PER_S = 0.005

export function Atmosphere() {
  const cloudsRef = useRef<Group>(null)
  const cloudTexture = useMemo(() => createCloudTextureDataUrl(), [])
  useFrame((_state, delta) => {
    if (cloudsRef.current) cloudsRef.current.rotation.y += CLOUD_DRIFT_RAD_PER_S * delta
  })

  return (
    <>
      <Environment files="/sky.hdr" background backgroundIntensity={1.1} environmentIntensity={0.9} />
      <fog attach="fog" args={[palette.sky, 5500, 12000]} />
      <directionalLight
        color={palette.sun}
        position={SUN_POSITION}
        intensity={1.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-SHADOW_EXTENT_M}
        shadow-camera-right={SHADOW_EXTENT_M}
        shadow-camera-top={SHADOW_EXTENT_M}
        shadow-camera-bottom={-SHADOW_EXTENT_M}
        shadow-camera-near={10}
        shadow-camera-far={SUN_POSITION[1] + SHADOW_EXTENT_M * 4}
        shadow-bias={-0.0003}
        shadow-normalBias={0.4}
      />
      <group ref={cloudsRef} position={[0, CLOUD_HEIGHT_M, 0]}>
        <Clouds texture={cloudTexture} limit={40}>
          <Cloud seed={1} position={[-1200, 200, -600]} segments={22} bounds={[3800, 220, 3800]} volume={650} opacity={0.4} fade={10000} speed={0.1} growth={180} color="#fff3e6" />
          <Cloud seed={2} position={[1600, -150, 800]} segments={18} bounds={[4200, 200, 4200]} volume={800} opacity={0.3} fade={10000} speed={0.08} growth={160} color="#ffe9d2" />
          <Cloud seed={3} position={[0, 300, 2200]} segments={16} bounds={[3200, 180, 3200]} volume={550} opacity={0.3} fade={10000} speed={0.12} growth={150} color="#fff6ec" />
        </Clouds>
      </group>
    </>
  )
}
