import { BufferAttribute, BufferGeometry, Color, type Material, type Mesh, MeshStandardMaterial } from 'three'
import type { CityMesh, PrismMesh } from './extrude.ts'
import type { ShadingUniforms } from './groundShading.ts'
import { FACADE_AVERAGE, FACADE_AVERAGE_PARS, FACADE_COLOR, FACADE_PARS, FACADE_REFLECTION, FACADE_ROUGHNESS, FACADE_SPECULAR } from './facade.ts'
import { type Fade, withDither } from './stream/dither.ts'
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

// The worker's meshes, an index of either width.
type CityMeshArrays = Omit<CityMesh, 'index'> & { index: Uint16Array | Uint32Array }
type PrismMeshArrays = Omit<PrismMesh, 'index'> & { index: Uint16Array | Uint32Array }

// A tile's buildings from the tile worker's arrays (stream/tileBuild.ts):
// in full (extrude.ts extrudeBuildings) up close, as plain prisms
// (extrudePrisms) further off and for the far blocks.
export function nearGeometry(m: CityMeshArrays): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(m.positions, 3))
  g.setAttribute('normal', new BufferAttribute(m.normals, 3))
  g.setAttribute('ring', new BufferAttribute(m.ring, 1))
  g.setAttribute('colorIndex', new BufferAttribute(m.colorIndex, 1))
  g.setAttribute('facade', new BufferAttribute(m.facade, 4))
  g.setAttribute('material', new BufferAttribute(m.material, 1))
  g.setAttribute('storefront', new BufferAttribute(m.storefront, 1))
  g.setAttribute('localY', new BufferAttribute(m.localY, 1))
  g.setIndex(new BufferAttribute(m.index, 1))
  g.computeBoundingSphere()
  return g
}

export function prismGeometry(m: PrismMeshArrays): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(m.positions, 3))
  g.setAttribute('prism', new BufferAttribute(m.prism, 4))
  g.setAttribute('localY', new BufferAttribute(m.localY, 1))
  g.setIndex(new BufferAttribute(m.index, 1))
  g.computeBoundingSphere()
  return g
}

// Each tile's own (its contact map; its fade), sharing one program per
// level: `dither` for the copy drawn while a tile changes level (dither.ts).
export function nearBuildingMaterial(shading: ShadingUniforms, fade: Fade, dither = false): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: palette.building, roughness: 0.92, metalness: 0 })
  material.onBeforeCompile = (shader) => {
    registerHeightFog(shader)
    shader.uniforms.uFade = fade
    shader.uniforms.uContactAo = shading.uContactAo
    shader.uniforms.uContactUv = shading.uContactUv
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
        `#include <common>\nuniform vec3 uBase;\nuniform vec3 uDim;\nuniform vec3 uBuildingColors[${palette.buildingColors.length}];\nuniform sampler2D uContactAo;\nuniform vec4 uContactUv;\nvarying vec2 vGround;\nvarying float vRing;\nvarying float vY;\nvarying float vWall;\nvarying float vColorIndex;\n${FACADE_PARS}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        diffuseColor.rgb = uBuildingColors[int(vColorIndex + 0.5)];
        ${FACADE_COLOR}
        float lift = mix(${BASE_FLOOR.toFixed(2)}, 1.0, smoothstep(0.0, ${BASE_FADE_M.toFixed(1)}, vY));
        diffuseColor.rgb = mix(uBase, diffuseColor.rgb, mix(1.0, lift, vWall));
        float wallContact = texture2D(uContactAo, vGround * uContactUv.xy + uContactUv.zw).r * (1.0 - smoothstep(0.0, ${WALL_CONTACT_M.toFixed(1)}, vY));
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
    shader.fragmentShader = withDither(shader.fragmentShader, dither)
  }
  material.customProgramCacheKey = () => `city-buildings-v27${dither ? '-dither' : ''}`
  return material
}

// Buildings at middle distance and the far blocks: plain prisms (extrude.ts
// extrudePrisms), flat-shaded from the screen's derivatives, their walls
// the windows' average (facade.ts FACADE_AVERAGE), with the near
// material's street-level darkening, ring fade and roofs. No contact
// shading: at this distance it's under a pixel.
export function midBuildingMaterial(fade: Fade, dither = false): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: palette.building, roughness: 0.92, metalness: 0, flatShading: true })
  material.onBeforeCompile = (shader) => {
    registerHeightFog(shader)
    shader.uniforms.uFade = fade
    shader.uniforms.uBase = { value: new Color(palette.buildingBase) }
    shader.uniforms.uDim = sceneUniforms.uHaze
    shader.uniforms.uBuildingColors = { value: palette.buildingColors.map((c) => new Color(c)) }
    shader.uniforms.uSkyReflection = sceneUniforms.uHaze
    shader.uniforms.uWindowsOn = sceneUniforms.uWindowsOn
    shader.uniforms.uHour = sceneUniforms.uHour
    shader.uniforms.uWeekend = sceneUniforms.uWeekend
    shader.uniforms.uStoneColors = { value: palette.stoneTowerColors.map((c) => new Color(c)) }
    shader.uniforms.uPaleStone = { value: new Color(palette.landmarkPaleStone) }
    shader.uniforms.uGranite = { value: new Color(palette.landmarkGranite) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 prism;\nattribute float localY;\nvarying vec4 vPrism;\nvarying float vY;\nvarying vec3 vWorld;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPrism = prism;\nvY = localY;\nvWorld = position;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nuniform vec3 uBase;\nuniform vec3 uDim;\nuniform vec3 uBuildingColors[${palette.buildingColors.length}];\nvarying vec4 vPrism;\nvarying float vY;\nvarying vec3 vWorld;\n${FACADE_AVERAGE_PARS}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 prismN = normalize( cross( dFdx( vWorld ), dFdy( vWorld ) ) );
        float vWall = 1.0 - step( 0.5, abs( prismN.y ) );
        vec2 vGround = vWorld.xz;
        float fcMat = floor( vPrism.x / 10.0 + 0.05 );
        float fcCI = floor( vPrism.x - 10.0 * fcMat + 0.5 );
        diffuseColor.rgb = uBuildingColors[ int( fcCI ) ];
        ${FACADE_AVERAGE}
        float lift = mix(${BASE_FLOOR.toFixed(2)}, 1.0, smoothstep(0.0, ${BASE_FADE_M.toFixed(1)}, vY));
        diffuseColor.rgb = mix(uBase, diffuseColor.rgb, mix(1.0, lift, vWall));
        diffuseColor.rgb = mix(diffuseColor.rgb, uDim, ${RING_DIM_MAX.toFixed(3)} * smoothstep(0.0, 1.0, vPrism.y));
        diffuseColor.rgb *= mix(${ROOF_SHADE.toFixed(2)}, 1.0, vWall);
        float roofGray = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(roofGray), ${ROOF_NIGHT_GRAY.toFixed(2)} * uWindowsOn * (1.0 - vWall));`,
      )
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FACADE_ROUGHNESS}`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${FACADE_SPECULAR}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FACADE_REFLECTION}`)
    shader.fragmentShader = withDither(shader.fragmentShader, dither)
  }
  material.customProgramCacheKey = () => `city-buildings-mid-v1${dither ? '-dither' : ''}`
  return material
}

declare global {
  interface Window {
    // ?demo only: whether the city's shader programs are runnable, each set
    // on its draws (__cityShaders: the full buildings, the prisms, the
    // ground, the canopy), and all of them together once the full
    // buildings have drawn. A shader that fails to compile drops what it
    // draws while everything else still renders; npm run smoke checks this.
    __cityDrawn?: boolean
    __cityShaders?: Record<string, boolean>
  }
}

// Asks WebGL itself whether the program linked: three.js's own diagnostics
// aren't always filled in for a failed compile. Cached per program. The hook
// also runs in the shadow and SSAO normal passes, with their own working
// materials, so only the mesh's own material counts.
type ProgramInfo = { currentProgram?: { program: WebGLProgram } }
const linked = new WeakMap<WebGLProgram, boolean>()
export const reportDrawn = (own: Material, name: string): Mesh['onAfterRender'] => (renderer, _scene, _camera, _geometry, material) => {
  if (material !== own) return
  const program = (renderer.properties.get(material) as ProgramInfo).currentProgram?.program
  let ok = false
  if (program) {
    const known = linked.get(program)
    if (known === undefined) {
      const gl = renderer.getContext()
      ok = gl.getProgramParameter(program, gl.LINK_STATUS) === true
      linked.set(program, ok)
    } else ok = known
  }
  const shaders = (window.__cityShaders ??= {})
  shaders[name] = ok
  window.__cityDrawn = 'buildings' in shaders && Object.values(shaders).every(Boolean)
}
