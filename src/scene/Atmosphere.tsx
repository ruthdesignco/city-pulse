import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { DirectionalLight, Group, Object3D } from 'three'
import { palette } from '../city/palette.ts'
import { createCloudTexture } from './cloudTexture.ts'
import { createSkyBackgroundTexture } from './skyBackground.ts'
import { SUN_POSITION } from './sun.ts'
import { TARGET } from './view.ts'

// Fraction from the top of frame where the sun's glow reads, for the
// background gradient's warm band (skyBackground.ts) -- this camera's
// opening shot sits with the true horizon almost exactly at the top edge
// (Atmosphere.tsx's CLOUD_PUFFS comment), so "low in the sky" lands near the
// very top of frame, not the middle.
const SUN_SCREEN_Y = 0.18

// Daytime golden hour, merged from two tried directions (see git history on
// look-golden/look-stylized): this direction's own SkyDome (not drei's
// procedural <Sky> -- see SkyDome.tsx for why), golden's shadow/light
// structure, a realistic-SF building palette at a brighter, lighter value
// range, and a pulled-back, warm-but-neutral color grade throughout.
//
// The directional light is the scene's main light; the hemisphere light
// fills shadows with the same warm-above/dark-below split.
const SHADOW_EXTENT_M = 3600

// Clouds drift by slowly rotating the whole layer about the vertical axis --
// simpler than translating individual puffs and wrapping them at the edges,
// and reads the same from an orbiting camera. One full pass overhead takes
// about 20 minutes; "soft," not a time-lapse.
//
// Positions are computed along the opening camera's actual view direction
// (view.ts), not just "near TARGET": with a 40 deg (vertical) FOV, puffs
// merely offset from TARGET by hundreds of meters land tens of degrees off
// the view direction (a camera at ~1800m from TARGET only has to offset
// ~650m to swing 20 deg) -- confirmed by placing one deliberately huge,
// fully opaque, camera-facing puff and seeing nothing. These anchors sit
// just above the horizon line within the frame (the opening shot's own top
// edge sits almost exactly at the horizon, so "low in the sky" is the only
// band that's actually visible there).
const CLOUD_HEIGHT_M = 950
const CLOUD_DRIFT_RAD_PER_S = 0.005

interface CloudPuff {
  position: [number, number, number]
  scale: number
  opacity: number
  color: string
}
const CLOUD_PUFFS: CloudPuff[] = [
  { position: [-218, -512, -2960], scale: 750, opacity: 0.8, color: '#ffffff' },
  { position: [-80, -460, -3050], scale: 480, opacity: 0.65, color: '#fff6ec' },
  { position: [695, -416, -3283], scale: 700, opacity: 0.75, color: '#fff6ec' },
  { position: [850, -370, -3200], scale: 460, opacity: 0.6, color: '#ffffff' },
  { position: [1410, -491, -2776], scale: 750, opacity: 0.8, color: '#ffffff' },
  { position: [1560, -450, -2850], scale: 480, opacity: 0.65, color: '#fffaf0' },
  { position: [2363, -379, -2658], scale: 700, opacity: 0.75, color: '#fffaf0' },
  { position: [2220, -330, -2600], scale: 460, opacity: 0.6, color: '#fff6ec' },
  { position: [2588, -599, -1634], scale: 680, opacity: 0.7, color: '#fff6ec' },
  { position: [2450, -560, -1550], scale: 440, opacity: 0.55, color: '#ffffff' },
  { position: [-838, -637, -2681], scale: 700, opacity: 0.75, color: '#ffffff' },
  { position: [-980, -590, -2600], scale: 460, opacity: 0.6, color: '#fffaf0' },
]

export function Atmosphere() {
  const { scene } = useThree()
  const lightRef = useRef<DirectionalLight>(null)
  const lightTargetRef = useRef<Object3D>(null)
  const cloudsRef = useRef<Group>(null)
  const cloudTexture = useMemo(() => createCloudTexture(), [])
  const skyTexture = useMemo(
    () => createSkyBackgroundTexture(palette.sky, palette.skyZenith, palette.sun, SUN_SCREEN_Y),
    [],
  )
  useEffect(() => {
    // oxlint's react(immutability) flags this (mutating useThree()'s scene),
    // but it's r3f's own documented pattern for scene.background/environment
    // -- there's no hook-owned setter for it.
    scene.background = skyTexture
    return () => {
      scene.background = null
    }
  }, [scene, skyTexture])
  // The shadow camera's ortho frustum (shadow-camera-left/right/top/bottom
  // below) is centered on the light's target, which three.js defaults to
  // world (0,0,0) if never set -- not TARGET, ~1800 m away, where the city
  // and camera actually are. Ground and buildings beyond the mismatched
  // frustum's edge fell outside shadow coverage and sampled as spuriously
  // dark, which was the real cause of the "dark band" near the horizon
  // (every sky-side hypothesis -- fog range, SSAO, the dome shader itself --
  // left this unchanged, since none of them touch shadow-camera framing).
  useEffect(() => {
    if (lightRef.current && lightTargetRef.current) lightRef.current.target = lightTargetRef.current
  }, [])
  useFrame((_state, delta) => {
    if (cloudsRef.current) cloudsRef.current.rotation.y += CLOUD_DRIFT_RAD_PER_S * delta
  })

  return (
    <>
      <hemisphereLight args={[palette.sun, palette.ground, 0.75]} />
      {/* City buildings mostly sit within ~2-3 km of TARGET (SPEC.md): near
          keeps most of downtown crisp. far is well inside Ground.tsx's dark
          near-plane edge (4500 m radius) so that plane always finishes
          fading to this same palette.sky color before reaching it -- the
          unlit backdrop plane beyond takes over already in that color, so
          there's no edge or gradient left exposed to show as a seam. */}
      <fog attach="fog" args={[palette.sky, 2000, 4200]} />
      <object3D ref={lightTargetRef} position={TARGET} />
      <directionalLight
        ref={lightRef}
        color={palette.sun}
        position={SUN_POSITION}
        intensity={2.3}
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
        shadow-radius={3}
      />
      <group ref={cloudsRef} position={[TARGET[0], CLOUD_HEIGHT_M, TARGET[2]]}>
        {CLOUD_PUFFS.map((p, i) => (
          <sprite key={i} position={p.position} scale={[p.scale, p.scale * 0.6, 1]}>
            {/* fog off: these sit just above the horizon specifically to read
              as a cloud layer against the sky -- the tighter near-camera
              fog tuned for Ground.tsx's dark-to-sky fade (its own comment)
              washed them out almost to invisible when they inherited it. */}
          <spriteMaterial map={cloudTexture} color={p.color} opacity={p.opacity} transparent depthWrite={false} fog={false} />
          </sprite>
        ))}
      </group>
    </>
  )
}
