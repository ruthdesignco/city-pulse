import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import type { DirectionalLight, Group, Object3D } from 'three'
import { palette } from '../city/palette.ts'
import { createCloudTexture } from './cloudTexture.ts'
import { SKY_INTENSITY, SKY_LIGHT_COLOR, SUN_INTENSITY } from './lighting.ts'
import { createSkyBackgroundTexture } from './skyBackground.ts'
import { SUN_POSITION, sunLightPosition } from './sun.ts'
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
//
// Fewer, higher, thinner than the first pass (6 instead of 12, taller and
// further out, a flat 0.22 aspect instead of 0.6): round-ish puffs this
// close read as distinct sprite blobs, not a cloud layer. Spread thin and
// high, lower-opacity, they read as haze/streak instead.
const CLOUD_HEIGHT_M = 1500
const CLOUD_DRIFT_RAD_PER_S = 0.005

interface CloudPuff {
  position: [number, number, number]
  scale: number
  opacity: number
  color: string
}
// Recomputed along the opening camera's actual view direction (same
// technique as the first pass, now for CLOUD_HEIGHT_M=1500): bearing
// offsets of -16..+18deg from view center, elevation -1deg (just inside the
// top edge, which sits almost exactly at the horizon), 4200m out.
const CLOUD_PUFFS: CloudPuff[] = [
  { position: [2100, -821, -1579], scale: 1300, opacity: 0.45, color: '#ffffff' },
  { position: [1704, -821, -1905], scale: 1100, opacity: 0.4, color: '#fff6ec' },
  { position: [1335, -821, -2144], scale: 1400, opacity: 0.48, color: '#fffaf0' },
  { position: [876, -821, -2372], scale: 1150, opacity: 0.38, color: '#ffffff' },
  { position: [393, -821, -2542], scale: 1250, opacity: 0.42, color: '#fff6ec' },
  { position: [-108, -821, -2653], scale: 1200, opacity: 0.4, color: '#fffaf0' },
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
      {/* Sky fill and sun, both from lighting.ts: intensities and the sky's
          color are solved so a sunlit horizontal surface renders as its
          palette color, neutral -- the sun's warmth shows only on faces it
          hits, the sky's cool only in shadow. */}
      <hemisphereLight args={[SKY_LIGHT_COLOR, palette.ground, SKY_INTENSITY]} />
      {/* City buildings mostly sit within ~2-3 km of TARGET (SPEC.md): near
          keeps most of downtown crisp. far is gentle enough, now that
          Ground.tsx's plane is a mid-gray instead of near-black, to read as
          a continuous haze gradient out to its edge rather than either a
          dark band (too-short far, old dark ground) or a flat plateau
          (full convergence too early). */}
      <fog attach="fog" args={[palette.sky, 2000, 8000]} />
      <object3D ref={lightTargetRef} position={TARGET} />
      <directionalLight
        ref={lightRef}
        color={palette.sun}
        position={sunLightPosition(TARGET)}
        intensity={SUN_INTENSITY}
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
          <sprite key={i} position={p.position} scale={[p.scale, p.scale * 0.22, 1]}>
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
