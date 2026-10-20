import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { type Fog, type ShaderMaterial, Vector3 } from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'
import { SKY_EXPOSURE, SKY_PARAMS, SUN_DIRECTION, horizonColor } from './skyModel.ts'

// The sky: three's Sky (the Preetham daylight model) lit by the same sun as
// the scene's directional light (sun.ts), so the bright side of the sky is
// the side the light comes from. Its look (SKY_PARAMS) and exposure live in
// skyModel.ts, which also gives the fog its color: the sky's own horizon,
// in whatever direction the camera faces, so fogged ground and water meet
// the sky with no seam from any orbit angle.

// The Sky box, centered on the camera every frame; well inside camera.far.
const SKY_SIZE_M = 10000

export function SkyDome() {
  const sky = useMemo(() => {
    const s = new Sky()
    s.scale.setScalar(SKY_SIZE_M)
    s.frustumCulled = false
    const material = s.material as ShaderMaterial
    const u = material.uniforms
    u.sunPosition.value.copy(SUN_DIRECTION)
    u.turbidity.value = SKY_PARAMS.turbidity
    u.rayleigh.value = SKY_PARAMS.rayleigh
    u.mieCoefficient.value = SKY_PARAMS.mieCoefficient
    u.mieDirectionalG.value = SKY_PARAMS.mieDirectionalG
    u.cloudCoverage.value = 0
    // Sky.js has no exposure control of its own: scale its final color.
    const final = 'gl_FragColor = vec4( texColor, 1.0 );'
    if (!material.fragmentShader.includes(final)) throw new Error('SkyDome: Sky.js output line not found')
    material.fragmentShader = material.fragmentShader.replace(final, `gl_FragColor = vec4( texColor * ${SKY_EXPOSURE.toFixed(4)}, 1.0 );`)
    return s
  }, [])
  useEffect(() => () => (sky.material as ShaderMaterial).dispose(), [sky])

  const forward = useMemo(() => new Vector3(), [])
  useFrame(({ camera, scene }) => {
    sky.position.copy(camera.position)
    const fog = scene.fog as Fog | null
    if (!fog) return
    camera.getWorldDirection(forward)
    horizonColor(Math.atan2(forward.x, -forward.z), fog.color)
  })

  return <primitive object={sky} />
}
