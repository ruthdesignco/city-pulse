import { useEffect, useMemo } from 'react'
import { DEMO } from '../params.ts'
import { BufferAttribute, BufferGeometry, Color, type Material, type Mesh, MeshStandardMaterial } from 'three'
import { type LoadedCity, useCity } from './useCity.ts'
import { extrudeBuildings } from './extrude.ts'
import { type GroundShading, groundShading } from './groundShading.ts'
import { FACADE_COLOR, FACADE_PARS, FACADE_REFLECTION, FACADE_ROUGHNESS, FACADE_SPECULAR } from './facade.ts'
import { registerHeightFog, sceneUniforms } from '../scene/sceneUniforms.ts'
import { palette } from './palette.ts'
import { RING_DIM_MAX } from './ring.ts'

// Walls (not roofs) reach full color by this height; below it they blend
// toward buildingBase, a cheap stand-in for ambient occlusion at street
// level. Most SF buildings are 10-15 m, so keep this short and gentle.
const BASE_FADE_M = 12
const BASE_FLOOR = 0.55 // darkest a wall gets at street level, as a mix toward full color
// Walls also take the ground's contact shading where they stand
// (groundShading.ts: deepest in alleys and light wells), easing out over
// their lowest WALL_CONTACT_M, in place of SSAO (quality.ts).
const WALL_CONTACT_M = 6
// Context-ring buildings blend toward the sky color as ring.ts's ringDim().
// Walls get procedural windows (facade.ts).
// Roofs face the whole sky fill and read brightest from above; most real
// flat roofs (tar, gravel, membrane) are darker than the walls anyway.
const ROOF_SHADE = 0.8
// How far roofs go to gray at night.
const ROOF_NIGHT_GRAY = 0.75

function buildGeometry(city: LoadedCity): BufferGeometry {
  const started = performance.now()
  const mesh = extrudeBuildings(city.buildings, city.header.ringMeters, city.header.pinnedMaterials, city.streets, (x, z) => city.terrain.heightAt(x, z))
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3))
  g.setAttribute('normal', new BufferAttribute(mesh.normals, 3))
  g.setAttribute('ring', new BufferAttribute(mesh.ring, 1))
  g.setAttribute('colorIndex', new BufferAttribute(mesh.colorIndex, 1))
  g.setAttribute('facade', new BufferAttribute(mesh.facade, 4))
  g.setAttribute('material', new BufferAttribute(mesh.material, 1))
  g.setAttribute('storefront', new BufferAttribute(mesh.storefront, 1))
  g.setAttribute('localY', new BufferAttribute(mesh.localY, 1))
  g.setIndex(new BufferAttribute(mesh.index, 1))
  g.computeBoundingSphere()
  console.info(
    `city: ${city.buildings.counts.length} buildings, ${mesh.index.length / 3} triangles, extruded in ${(performance.now() - started).toFixed(0)} ms`,
  )
  return g
}

function buildMaterial(shading: GroundShading): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: palette.building, roughness: 0.92, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    registerHeightFog(shader)
    shader.uniforms.uContactAo = { value: shading.contact }
    shader.uniforms.uBase = { value: new Color(palette.buildingBase) }
    shader.uniforms.uDim = sceneUniforms.uHaze
    shader.uniforms.uBuildingColors = { value: palette.buildingColors.map((c) => new Color(c)) }
    // What the windows reflect (facade.ts): the haze at the horizon, by
    // time of day. Lit windows at night (facade.ts) read the hour and the
    // dusk-to-dawn factor.
    shader.uniforms.uSkyReflection = sceneUniforms.uHaze
    shader.uniforms.uWindowsOn = sceneUniforms.uWindowsOn
    shader.uniforms.uHour = sceneUniforms.uHour
    shader.uniforms.uWeekend = sceneUniforms.uWeekend
    shader.uniforms.uStoneColors = { value: palette.stoneTowerColors.map((c) => new Color(c)) }
    shader.uniforms.uPaleStone = { value: new Color(palette.landmarkPaleStone) }
    shader.uniforms.uGranite = { value: new Color(palette.landmarkGranite) }
    shader.uniforms.uAwnings = { value: palette.awnings.map((c) => new Color(c)) }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float ring;\nattribute float colorIndex;\nattribute vec4 facade;\nattribute float material;\nattribute float storefront;\nattribute float localY;\nvarying vec2 vGround;\nvarying float vRing;\nvarying float vY;\nvarying float vWall;\nvarying float vColorIndex;\nvarying vec4 vFacade;\nvarying float vMaterial;\nvarying float vStorefront;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGround = position.xz;\nvRing = ring;\nvY = localY;\nvWall = 1.0 - step(0.5, normal.y);\nvColorIndex = colorIndex;\nvFacade = facade;\nvMaterial = material;\nvStorefront = storefront;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec3 uBase;\nuniform vec3 uDim;\nuniform vec3 uBuildingColors[${palette.buildingColors.length}];\nuniform sampler2D uContactAo;\nvarying vec2 vGround;\nvarying float vRing;\nvarying float vY;\nvarying float vWall;\nvarying float vColorIndex;\n${FACADE_PARS}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb = uBuildingColors[int(vColorIndex + 0.5)];
        ${FACADE_COLOR}
        float lift = mix(${BASE_FLOOR.toFixed(2)}, 1.0, smoothstep(0.0, ${BASE_FADE_M.toFixed(1)}, vY));
        diffuseColor.rgb = mix(uBase, diffuseColor.rgb, mix(1.0, lift, vWall));
        float wallContact = texture2D(uContactAo, ${shading.contactUv('vGround')}).r * (1.0 - smoothstep(0.0, ${WALL_CONTACT_M.toFixed(1)}, vY));
        diffuseColor.rgb *= 1.0 - wallContact * vWall;
        diffuseColor.rgb = mix(diffuseColor.rgb, uDim, ${RING_DIM_MAX.toFixed(3)} * smoothstep(0.0, 1.0, vRing));
        diffuseColor.rgb *= mix(${ROOF_SHADE.toFixed(2)}, 1.0, vWall);
        // At night roofs lose most of their color (glass-tower roofs read
        // saturated blue against the dark otherwise): moonlight shows little.
        float roofGray = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(roofGray), ${ROOF_NIGHT_GRAY.toFixed(2)} * uWindowsOn * (1.0 - vWall));`,
      )
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FACADE_ROUGHNESS}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${FACADE_SPECULAR}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FACADE_REFLECTION}`)
  }
  material.customProgramCacheKey = () => 'city-buildings-v26'
  return material
}

declare global {
  interface Window {
    // ?demo only: whether the city mesh's shader program is runnable, set on
    // each draw. A shader that fails to compile drops the whole city while
    // everything else still renders; npm run smoke checks this.
    __cityDrawn?: boolean
  }
}

// Asks WebGL itself whether the program linked: three.js's own diagnostics
// aren't always filled in for a failed compile. Cached per program. The hook
// also runs in the shadow and SSAO normal passes, with their own working
// materials, so only the city's own material counts.
type ProgramInfo = { currentProgram?: { program: WebGLProgram } }
const linked = new WeakMap<WebGLProgram, boolean>()
const reportDrawn = (own: Material): Mesh['onAfterRender'] => (renderer, _scene, _camera, _geometry, material) => {
  if (material !== own) return
  const program = (renderer.properties.get(material) as ProgramInfo).currentProgram?.program
  if (!program) {
    window.__cityDrawn = false
    return
  }
  let ok = linked.get(program)
  if (ok === undefined) {
    const gl = renderer.getContext()
    ok = gl.getProgramParameter(program, gl.LINK_STATUS) === true
    linked.set(program, ok)
  }
  window.__cityDrawn = ok
}

export function Buildings() {
  const city = useCity()
  const geometry = useMemo(() => buildGeometry(city), [city])
  const material = useMemo(() => buildMaterial(groundShading(city)), [city])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  return <mesh geometry={geometry} material={material} castShadow receiveShadow onAfterRender={DEMO ? reportDrawn(material) : undefined} />
}
