import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { DirectionalLight, Object3D, Vector3 } from 'three'
import { palette } from '../city/palette.ts'
import { SKY_INTENSITY, SKY_LIGHT_COLOR, SUN_INTENSITY } from './lighting.ts'
import { SHADOW_MAP_SIZE, fitShadow } from './shadowFit.ts'
import { SkyDome } from './SkyDome.tsx'
import { SUN_DISTANCE, sunLightPosition } from './sun.ts'
import { TARGET } from './view.ts'

// Daytime golden hour: a low sun in the west-southwest (sun.ts) lighting
// the city, the Preetham sky lit by that same sun (SkyDome.tsx), and fog in
// the sky's own horizon color.
//
// The directional light is the scene's main light; the hemisphere light
// fills shadows. Its shadow frustum follows the camera (shadowFit.ts).
// Shadow-map texels per meter vary with the fit, so the biases scale with
// the texel: enough to stop acne, not so much that shadows detach from walls.
const SHADOW_NORMAL_BIAS_TEXELS = 0.75

const FOG_NEAR_M = 4500
const FOG_FAR_M = 10000

export function Atmosphere() {
  const lightRef = useRef<DirectionalLight>(null)
  const lightTargetRef = useRef<Object3D>(null)
  // The shadow camera's ortho frustum (sized each frame below, shadowFit.ts)
  // is centered on the light's target, which three.js defaults to
  // world (0,0,0) if never set -- not TARGET, ~1800 m away, where the city
  // and camera actually are. Ground and buildings beyond the mismatched
  // frustum's edge fell outside shadow coverage and sampled as spuriously
  // dark, which was the real cause of the "dark band" near the horizon
  // (every sky-side hypothesis -- fog range, SSAO, the dome shader itself --
  // left this unchanged, since none of them touch shadow-camera framing).
  useEffect(() => {
    if (lightRef.current && lightTargetRef.current) lightRef.current.target = lightTargetRef.current
  }, [])
  // Last applied shadow fit, so the light only changes when the fit does.
  const fitKey = useRef('')
  useFrame((state) => {
    const light = lightRef.current
    const lightTarget = lightTargetRef.current
    if (!light || !lightTarget) return
    // OrbitControls (CameraRig, makeDefault) carry the point being looked at.
    const orbit = (state.controls as unknown as { target?: Vector3 } | null)?.target
    const look: [number, number, number] = orbit ? [orbit.x, orbit.y, orbit.z] : TARGET
    const fit = fitShadow(look, state.camera.position.distanceTo({ x: look[0], y: look[1], z: look[2] } as Vector3))
    const key = `${fit.center.join()},${fit.extent}`
    if (key === fitKey.current) return
    fitKey.current = key
    lightTarget.position.set(...fit.center)
    light.position.set(...sunLightPosition(fit.center))
    const cam = light.shadow.camera
    cam.left = -fit.extent
    cam.right = fit.extent
    cam.top = fit.extent
    cam.bottom = -fit.extent
    cam.far = SUN_DISTANCE + 2 * fit.extent
    cam.updateProjectionMatrix()
    light.shadow.normalBias = SHADOW_NORMAL_BIAS_TEXELS * fit.texel
  })

  return (
    <>
      {/* Sky fill and sun, both from lighting.ts: intensities and the sky's
          color are solved so a sunlit horizontal surface renders as its
          palette color, neutral -- the sun's warmth shows only on faces it
          hits, the sky's cool only in shadow. */}
      <hemisphereLight args={[SKY_LIGHT_COLOR, palette.bounce, SKY_INTENSITY]} />
      {/* Haze for the far distance only: the city and its skyline sit
          within ~3 km of the camera in the opening view and stay crisp
          (starting at 2 km washed the Financial District blue-gray); past
          FOG_NEAR_M the land and water fade into the sky, fully by
          FOG_FAR_M, well inside the land plane's edge (Ground.tsx). Its
          color follows the sky's horizon as the camera turns (SkyDome.tsx);
          palette.sky is where it starts. */}
      <fog attach="fog" args={[palette.sky, FOG_NEAR_M, FOG_FAR_M]} />
      <object3D ref={lightTargetRef} position={TARGET} />
      <directionalLight
        ref={lightRef}
        color={palette.sun}
        position={sunLightPosition(TARGET)}
        intensity={SUN_INTENSITY}
        castShadow
        shadow-mapSize={[SHADOW_MAP_SIZE, SHADOW_MAP_SIZE]}
        shadow-camera-near={10}
        shadow-bias={-0.0002}
        shadow-radius={1.5}
      />
      <SkyDome />
    </>
  )
}
