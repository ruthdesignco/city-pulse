import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Color, type Fog, type ShaderMaterial, Vector3 } from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { useSkyState } from './skyClock.ts'
import { HEIGHT_FOG_GLSL, HEIGHT_FOG_UNIFORMS } from './heightFog.ts'
import { registerHeightFog } from './sceneUniforms.ts'
import { GLOW_BEARING_POWER, GLOW_HEIGHT_POWER, SKY_EXPOSURE, SKY_PARAMS, type SkyLook, horizonColorFor } from './skyModel.ts'

// The sky: three's Sky (the Preetham daylight model) lit by the time of
// day's sun (skyState.ts), the same as the scene's directional light, so the
// bright side of the sky is the side the light comes from; blended to a
// blue-hour and then a night gradient after sunset (skyModel.ts skyColor,
// which this shader mirrors). Its look (SKY_PARAMS) and exposure live in
// skyModel.ts, which also gives the fog its color: the sky's own horizon,
// in whatever direction the camera faces, so fogged ground and water meet
// the sky with no seam from any orbit angle. Cloud cover blends it to a flat
// overcast gradient, and the height fog (heightFog.ts) covers it wherever the
// line of sight runs through the marine layer: all of it from inside the
// layer, none of it looking up from above.

// The Sky box, centered on the camera every frame; well inside camera.far.
const SKY_SIZE_M = 10000

function applySkyLook(material: ShaderMaterial, look: SkyLook) {
  const u = material.uniforms
  u.sunPosition.value.copy(look.sunDirection)
  u.uSkyExposure.value = look.exposure
  u.uNight.value = look.night
  u.uNightZenith.value.copy(look.nightZenith)
  u.uNightHorizon.value.copy(look.nightHorizon)
  u.uGlow.value = look.glow
  u.uGlowColor.value.copy(look.glowColor)
  u.uOvercast.value = look.overcast
  u.uOvercastZenith.value.copy(look.overcastZenith)
  u.uOvercastHorizon.value.copy(look.overcastHorizon)
}

export function SkyDome() {
  const sky = useMemo(() => {
    const s = new Sky()
    s.scale.setScalar(SKY_SIZE_M)
    s.frustumCulled = false
    const material = s.material as ShaderMaterial
    const u = material.uniforms
    u.uSkyExposure = { value: SKY_EXPOSURE }
    u.uNight = { value: 0 }
    u.uNightZenith = { value: new Color() }
    u.uNightHorizon = { value: new Color() }
    u.uGlow = { value: 0 }
    u.uGlowColor = { value: new Color() }
    u.uOvercast = { value: 0 }
    u.uOvercastZenith = { value: new Color() }
    u.uOvercastHorizon = { value: new Color() }
    registerHeightFog(material)
    u.turbidity.value = SKY_PARAMS.turbidity
    u.rayleigh.value = SKY_PARAMS.rayleigh
    u.mieCoefficient.value = SKY_PARAMS.mieCoefficient
    u.mieDirectionalG.value = SKY_PARAMS.mieDirectionalG
    u.cloudCoverage.value = 0
    // Sky.js has no exposure control of its own: scale its final color, then
    // blend toward the night gradient (skyModel.ts skyColor).
    const final = 'gl_FragColor = vec4( texColor, 1.0 );'
    if (!material.fragmentShader.includes(final)) throw new Error('SkyDome: Sky.js output line not found')
    material.fragmentShader =
      'uniform float uSkyExposure;\nuniform float uNight;\nuniform vec3 uNightZenith;\nuniform vec3 uNightHorizon;\nuniform float uGlow;\nuniform vec3 uGlowColor;\n' +
      'uniform float uOvercast;\nuniform vec3 uOvercastZenith;\nuniform vec3 uOvercastHorizon;\n' +
      HEIGHT_FOG_UNIFORMS +
      HEIGHT_FOG_GLSL +
      material.fragmentShader.replace(
        final,
        `float up = sqrt( clamp( direction.y, 0.0, 1.0 ) );
        float toward = max( 0.0, dot( normalize( direction.xz + 1e-6 ), normalize( vSunDirection.xz + 1e-6 ) ) );
        vec3 nightSky = mix( uNightHorizon, uNightZenith, up ) + uGlowColor * uGlow * pow( toward, ${GLOW_BEARING_POWER.toFixed(1)} ) * pow( 1.0 - up, ${GLOW_HEIGHT_POWER.toFixed(1)} );
        vec3 skyNow = mix( texColor * uSkyExposure, nightSky, uNight );
        skyNow = mix( skyNow, mix( uOvercastHorizon, uOvercastZenith, up ), uOvercast );
        skyNow = mix( skyNow, uFogColor, heightFogAmount( cameraPosition, vWorldPosition ) );
        gl_FragColor = vec4( skyNow, 1.0 );`,
      )
    return s
  }, [])
  useEffect(() => () => (sky.material as ShaderMaterial).dispose(), [sky])
  const state = useSkyState()
  useEffect(() => applySkyLook(sky.material as ShaderMaterial, state.sky), [sky, state])

  const forward = useMemo(() => new Vector3(), [])
  useFrame(({ camera, scene }) => {
    sky.position.copy(camera.position)
    const fog = scene.fog as Fog | null
    if (!fog) return
    camera.getWorldDirection(forward)
    horizonColorFor(Math.atan2(forward.x, -forward.z), state.sky, fog.color)
  })

  return <primitive object={sky} />
}
