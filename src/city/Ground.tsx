import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, type MeshStandardMaterial } from 'three'
import { TARGET } from '../scene/view.ts'
import { BayWater } from './BayWater.tsx'
import { type GroundMask, LAND_M, LAND_PLANE_Y, f, landMaterial, withLandUv } from './groundMaterial.ts'
import type { LandCover } from './landCover.ts'
import { landPars, landUniforms } from './landShading.ts'
import type { Terrain } from './terrain.ts'
import { LAND_Y, useCityBase } from './useCity.ts'

// The landforms around the city (bake-backdrop.ts; 50 m): the Marin
// Headlands, Angel Island, Yerba Buena Island, the East Bay hills, the
// cities around the Bay, and San Francisco's own hills wherever a tile's
// ground isn't drawn (yet, or too far off to need it). Colored by what's
// there (landShading.ts), fading into the haze with the fog. Under a
// tile's own ground it sinks out of sight (BACKDROP_UNDER_M), except along
// a cell's width at that ground's edge, so the two meet (the tiles' skirts
// hide the step): which tiles' ground is drawn is a texture (GroundMask),
// read in the vertex shader. Over its outer BACKDROP_TAPER_M it eases to
// sea level, meeting the flat land beyond.
const BACKDROP_UNDER_M = 60
const BACKDROP_TAPER_M = 2000

function buildBackdropGeometry(b: Terrain): BufferGeometry {
  const { x0, z0, cell, nx, nz } = b.header
  const position = new Float32Array(nx * nz * 3)
  const normal = new Float32Array(nx * nz * 3)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i
      const edge = Math.min(i, j, nx - 1 - i, nz - 1 - j) * cell
      const taper = Math.min(1, edge / BACKDROP_TAPER_M)
      position.set([x0 + i * cell, b.at(i, j) * taper * taper * (3 - 2 * taper) + LAND_Y, z0 + j * cell], 3 * k)
      const sx = (b.at(i + 1, j) - b.at(i - 1, j)) / (2 * cell)
      const sz = (b.at(i, j + 1) - b.at(i, j - 1)) / (2 * cell)
      const l = Math.hypot(sx, 1, sz)
      normal.set([-sx / l, 1 / l, -sz / l], 3 * k)
    }
  const index = new Uint32Array((nx - 1) * (nz - 1) * 6)
  let n = 0
  for (let j = 0; j < nz - 1; j++)
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i
      index.set([a, a + nx + 1, a + 1, a, a + nx, a + nx + 1], n)
      n += 6
    }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(position, 3))
  g.setAttribute('normal', new BufferAttribute(normal, 3))
  g.setIndex(new BufferAttribute(index, 1))
  withLandUv(g)
  g.computeBoundingSphere()
  return g
}

// The backdrop's material: the land's, colored by landColor from the
// backdrop's own (50 m) normals, sunk under the tiles' ground (GroundMask).
function backdropMaterial(landCover: LandCover, land: MeshStandardMaterial, mask: GroundMask, cell: number): MeshStandardMaterial {
  const material = land.clone()
  material.roughness = 1
  material.onBeforeCompile = (shader, renderer) => {
    land.onBeforeCompile(shader, renderer)
    Object.assign(shader.uniforms, landUniforms(landCover))
    shader.uniforms.uGroundMask = { value: mask.texture }
    shader.uniforms.uGroundMaskUv = { value: mask.uv }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uGroundMask;\nuniform vec4 uGroundMaskUv;\nvarying vec3 vLand;\nvarying vec3 vLandN;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vLand = vec3( position.xz, position.y - ${f(LAND_Y)} );
vLandN = normal;
{
  // Under a tile's ground by a cell all round: sunk.
  float under = 1.0;
  for ( int k = 0; k < 4; k++ ) {
    vec2 o = vec2( k == 1 || k == 3 ? 1.0 : -1.0, k >= 2 ? 1.0 : -1.0 ) * ${f(cell)};
    under = min( under, texture2D( uGroundMask, ( position.xz + o ) * uGroundMaskUv.xy + uGroundMaskUv.zw ).r );
  }
  transformed.y -= step( 0.5, under ) * ${f(BACKDROP_UNDER_M)};
}`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLand;\nvarying vec3 vLandN;\n${landPars(landCover)}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = landColor( vLand.xy, vLand.z, normalize( vLandN ), length( vViewPosition ) );')
  }
  material.customProgramCacheKey = () => 'backdrop-v2'
  return material
}

// The water's outline: the backdrop's box (BayWater.tsx).
function waterOutline(b: Terrain): [number, number][] {
  const { x0, z0, cell, nx, nz } = b.header
  const x1 = x0 + (nx - 1) * cell
  const z1 = z0 + (nz - 1) * cell
  return [
    [x0, z0],
    [x0, z1],
    [x1, z1],
    [x1, z0],
  ]
}

// The Bay (bay.ts, BayWater.tsx): real waterfront, drawn over the ground
// (the context ring reaches into the water at Mission Bay) but under the
// sidewalks and roads, so the piers' streets and the Bay Bridge approach
// stay on top.
const WATER_Y = 0.15

export function Ground({ mask }: { mask: GroundMask }) {
  const { backdrop, landCover } = useCityBase()
  const backdropGeometry = useMemo(() => buildBackdropGeometry(backdrop), [backdrop])
  const water = useMemo(() => waterOutline(backdrop), [backdrop])
  const land = landMaterial()
  const backdropLand = useMemo(() => backdropMaterial(landCover, land, mask, backdrop.header.cell), [landCover, land, mask, backdrop])
  useEffect(() => () => backdropGeometry.dispose(), [backdropGeometry])
  useEffect(() => () => backdropLand.dispose(), [backdropLand])

  return (
    <>
      <group rotation-x={-Math.PI / 2}>
        {/* Land beyond the baked city -- the peninsula carries on to the
            south -- textured as distant city blocks (landTexture.ts) that
            the fog (Atmosphere.tsx) fades into the sky's haze with
            distance. Centered on TARGET. */}
        <mesh position={[TARGET[0], -TARGET[2], LAND_PLANE_Y]} material={land} receiveShadow userData={{ noReflect: true }}>
          <planeGeometry args={[LAND_M, LAND_M]} />
        </mesh>
        <BayWater y={WATER_Y} outline={water} />
      </group>
      <mesh geometry={backdropGeometry} material={backdropLand} receiveShadow userData={{ noReflect: true }} />
    </>
  )
}
