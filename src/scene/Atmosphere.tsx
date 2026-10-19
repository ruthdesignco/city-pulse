import { palette } from '../city/palette.ts'
import { SUN_POSITION } from './sun.ts'

// Golden hour: a low warm sun from SF's real autumn sunset bearing (sun.ts)
// rakes across the grid and casts real shadows, with a cooler, dimmer
// hemisphere fill so shaded walls stay readable without competing with the
// key light. Linear fog in the sky color fades the context ring into the
// background.
//
// The shadow camera frustum is sized around the baked city, not the full
// 40,000 m ground plane (Ground.tsx) -- a low sun angle casts long shadows,
// so this errs wide rather than clipping them at the edge of view.
const SHADOW_EXTENT_M = 3600

export function Atmosphere() {
  return (
    <>
      <color attach="background" args={[palette.sky]} />
      <fog attach="fog" args={[palette.sky, 4500, 11000]} />
      <hemisphereLight args={[palette.skyFill, palette.groundFill, 1.0]} />
      <directionalLight
        color={palette.sun}
        position={SUN_POSITION}
        intensity={3.1}
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
    </>
  )
}
