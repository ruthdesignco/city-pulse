// Procedural windows for the building walls (Buildings.tsx), drawn in the
// shader from each wall's position and size (extrude.ts `facade`): no
// textures. One parameter set per building family (scripts/lib/
// buildingColor.ts BuildingColorType), varied per building by its seed so
// blocks don't look stamped:
//
//   Neutral      commercial and light industrial: tall ~4 m floors, wide
//                windows spaced out, often split by a mullion
//   Residential  San Francisco stucco: ~3.1 m floors, punched windows, dark
//                panes set into the wall
//   Tower        curtain wall: ~3.5 m floors, near-continuous glass between
//                narrow mullions and spandrel bands, cool and darker, with a
//                Fresnel sky reflection and a sun glint
//   Stone tower  about a third of towers, chosen per building by its seed
//                (isStoneTower): stone or concrete in a masonry tone
//                (palette.stoneTowerColors) with punched windows, so the
//                skyline isn't uniformly blue-gray glass
//
// Storefronts: walls that front a street (frontage.ts) get a taller ground
// floor, ~4.5 m, of wide shop glass between narrow piers over a low
// bulkhead, with a fascia band or a colored awning line above it; the
// upper floors' grid starts above that. Bay width, floor height and the
// band vary per building.
//
// Window columns are centered on each wall, so no window is cut at a
// corner; the top floor stops below a parapet. Where window columns or
// floors get narrower than a few pixels (far away, or edge-on), that
// direction of the pattern fades to its average -- each separately, so a
// distant tower keeps its floor lines after its columns have blended out --
// so distance never shimmers and never changes a wall's brightness.

import { Color } from 'three'
import { palette } from './palette.ts'
import { LIT_SHARE_GLSL } from './windowLight.ts'

export interface Facade {
  floorM: number // floor-to-floor height
  spacingM: number // window column spacing
  width: number // window width, as a share of its column
  height: number // window height, as a share of its floor
  sill: number // window bottom, as a share of its floor
  // Per-building variation, as +- shares of the value above.
  varyFloor: number
  varySpacing: number
  varyWidth: number
  mullion: number // share of buildings whose windows a center mullion splits
  glass: string // pane color, as lit albedo
  // Sky reflection on the panes: glass towers only. Punched windows in sun
  // read as pale gray blanks with it (strong at grazing angles), so they
  // get none, and matte panes (high roughness) so the sun can't glint them
  // pale either: they stay dark, as real recessed windows look in daylight.
  reflect: number
  glint: number // pane roughness (lower = sharper sun glints)
}

// Indexed by BuildingColorType (Neutral, Residential, Tower), then
// STONE_TOWER for the towers isStoneTower picks.
export const STONE_TOWER = 3
export const FACADES: [Facade, Facade, Facade, Facade] = [
  {
    floorM: 4.0,
    spacingM: 3.6,
    width: 0.52,
    height: 0.5,
    sill: 0.3,
    varyFloor: 0.12,
    varySpacing: 0.35,
    varyWidth: 0.35,
    mullion: 0.5,
    glass: '#3b4247',
    reflect: 0,
    glint: 0.85,
  },
  {
    floorM: 3.1,
    spacingM: 3.0,
    width: 0.4,
    height: 0.52,
    sill: 0.3,
    varyFloor: 0.06,
    varySpacing: 0.3,
    varyWidth: 0.3,
    mullion: 0.6,
    glass: '#2d3135',
    reflect: 0,
    glint: 0.85,
  },
  {
    floorM: 3.5,
    spacingM: 1.6,
    width: 0.88,
    height: 0.72,
    sill: 0.14,
    varyFloor: 0.05,
    varySpacing: 0.25,
    varyWidth: 0.06,
    mullion: 0,
    glass: '#34414e',
    reflect: 1,
    glint: 0.25,
  },
  {
    floorM: 3.5,
    spacingM: 2.4,
    width: 0.44,
    height: 0.56,
    sill: 0.24,
    varyFloor: 0.05,
    varySpacing: 0.25,
    varyWidth: 0.2,
    mullion: 0.4,
    glass: '#2f3439',
    reflect: 0,
    glint: 0.85,
  },
]

// A facade material pinned for a landmark (scripts/lib/landmarkMaterials.ts,
// the tiles' `pinnedMaterials`), overriding the random choice below.
export const PinnedMaterial = { Auto: 0, Glass: 1, PaleStone: 2, Granite: 3 } as const
export type PinnedMaterial = (typeof PinnedMaterial)[keyof typeof PinnedMaterial]

// The share of towers built in stone or concrete instead of curtain wall.
export const STONE_TOWER_SHARE = 1 / 3
// Which towers: a hash of the building's seed (extrude.ts), independent of
// the other per-building variations. The multiplier is a whole number so
// the hash stays evenly spread (3.71 wrapped unevenly and picked only 22%
// of towers). Mirrored in FACADE_COLOR.
const STONE_HASH = [17, 0.29]
const fract = (x: number) => x - Math.floor(x)
// Pinned codes from here up are stone.
const PINNED_STONE_FROM = PinnedMaterial.PaleStone - 0.5
export function isStoneTower(seed: number): boolean {
  return fract(seed * STONE_HASH[0] + STONE_HASH[1]) < STONE_TOWER_SHARE
}

// No windows on buildings lower than this (sheds, kiosks, garages) or on
// walls shorter than this.
export const MIN_HEIGHT_M = 6
export const MIN_WALL_M = 3
// Blank wall kept at each end of a wall and at the top (parapet).
export const WALL_MARGIN_M = 0.6
export const PARAPET_M = 1.0
// Each direction of the pattern fades out as its cells shrink from this
// many pixels to this many.
export const DETAIL_FULL_PX = 7
export const DETAIL_GONE_PX = 2.5
// A center mullion's width, as a share of the window column.
const MULLION = 0.03

// Storefront ground floor, in meters. The glass runs from the bulkhead up
// to SHOP_GLASS_GAP_M below the floor's top; the band sits in that gap.
export const SHOP_FLOOR_M = 4.5
export const SHOP_FLOOR_VARY = 0.08
export const SHOP_BAY_M = 5.5
export const SHOP_BAY_VARY = 0.3
export const SHOP_PIER_M = 0.45
export const SHOP_BULKHEAD_M = 0.45
export const SHOP_GLASS_GAP_M = 1.15
export const SHOP_BAND: [number, number] = [0.4, 1.0] // band from/to, meters below the floor's top
export const SHOP_GLASS = '#3a454e'
export const SHOP_REFLECT = 0
export const SHOP_GLINT = 0.85
// The share of storefronts with a colored awning line (palette.awnings);
// the rest get a fascia, the wall's own color darkened.
export const AWNING_SHARE = 0.55
export const FASCIA_SHADE = 0.6

// Lit windows at night: emitted light (not lit by the scene), so they glow
// against the dark without bloom. Brightness in scene units at the night
// exposure; storefronts a little brighter. Which windows: windowLight.ts.
export const WINDOW_RADIANCE = 0.5
export const SHOP_RADIANCE = 0.75
// Offices lit with cooler LED white, as a share of their lit windows, and
// a little brighter (a pale cool fill otherwise reads as an empty pane).
export const COOL_OFFICE_SHARE = 0.3
export const COOL_BOOST = 1.35
// A lit window is brighter toward its top, where the ceiling lights are:
// this much at its foot, 1 at its head.
export const WINDOW_FOOT = 0.7
// From afar, between single windows and the full average: blocks this many
// windows wide and floors tall light (or not) together, at the same lit
// share, so a city seen from the air keeps a sparkle of lit patches (a
// tower's floors are only ~2-3 px from the opening view; 2x2 blocks ~5+).
export const WINDOW_BLOCK_COLUMNS = 2
export const WINDOW_BLOCK_FLOORS = 2
// Sub-pixel lights read brighter than their arithmetic average: lit blocks
// are lifted this much. The even average past them (where even blocks are
// sub-pixel) is lifted only FAR_AVERAGE, or whole walls glow.
export const FAR_GLOW = 2.2
export const FAR_AVERAGE = 0.65
// Blocks keep their detail down to smaller sizes than single windows (a lit
// block is a soft glow, not an edge), so distant towers keep a sparkle.
export const BLOCK_FULL_PX = 4
export const BLOCK_GONE_PX = 1.2
// How much of the faded glow varies block to block at full night (the rest
// is the even average; less through dusk): blocks are a variation in the
// glow, not hard on/off squares.
export const BLOCK_CONTRAST = 0.8

// The share of a window cell that is glass: what a wall averages to once
// the pattern has faded with distance. Mirrors `coverage` in FACADE_COLOR.
export function glassShare(width: number, height: number, mullion: boolean): number {
  return height * (width - (mullion ? 2 * MULLION : 0))
}

const v = (n: number) => n.toFixed(4)
const vec3 = (hex: string) => {
  const c = new Color(hex)
  return `vec3( ${v(c.r)}, ${v(c.g)}, ${v(c.b)} )`
}
const pick = (key: (f: Facade) => string) =>
  `( fcType == 0 ? ${key(FACADES[0])} : fcType == 1 ? ${key(FACADES[1])} : fcType == 2 ? ${key(FACADES[2])} : ${key(FACADES[3])} )`

// Declarations for the fragment shader (after #include <common>).
export const FACADE_PARS = /* glsl */ `
uniform vec3 uSkyReflection;
uniform vec3 uStoneColors[3];
uniform vec3 uPaleStone;
uniform vec3 uGranite;
uniform vec3 uAwnings[5];
uniform float uWindowsOn;
uniform float uHour;
uniform float uWeekend;
float fcHash( vec3 p ) {
  return fract( sin( dot( p, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
}
${LIT_SHARE_GLSL}
varying vec4 vFacade;
varying float vMaterial;
varying float vStorefront;
float facadeBox( float x, float lo, float hi, float aa ) {
  return smoothstep( lo - aa, lo + aa, x ) * ( 1.0 - smoothstep( hi - aa, hi + aa, x ) );
}
`

// Run after the wall's base color is in diffuseColor.rgb (color_fragment);
// a stone tower's wall color is swapped in here, from its color variant.
// Declares windowGlass, windowReflect and windowGlint for the later chunks.
// Derivatives are taken unconditionally, as GLSL requires.
export const FACADE_COLOR = /* glsl */ `
float fcSeed = vFacade.w;
float fcFamily = floor( ( vColorIndex + 0.5 ) / 3.0 );
// Towers: stone by the random choice, unless a landmark's material is pinned
// (any pinned material makes it a tower facade, glass or stone).
float fcPinned = step( 0.5, vMaterial );
float fcTower = max( step( 1.5, fcFamily ), fcPinned );
float fcRandomStone = step( fract( fcSeed * ${v(STONE_HASH[0])} + ${v(STONE_HASH[1])} ), ${v(STONE_TOWER_SHARE)} );
float fcStone = fcTower * mix( fcRandomStone, step( ${v(PINNED_STONE_FROM)}, vMaterial ), fcPinned );
int fcType = fcStone > 0.5 ? ${STONE_TOWER} : fcTower > 0.5 ? 2 : int( fcFamily );
vec3 fcStoneColor = vMaterial > ${v(PinnedMaterial.Granite - 0.5)} ? uGranite : vMaterial > ${v(PinnedMaterial.PaleStone - 0.5)} ? uPaleStone : uStoneColors[ int( mod( vColorIndex + 0.5, 3.0 ) ) ];
diffuseColor.rgb = mix( diffuseColor.rgb, fcStoneColor, fcStone );
float fcS1 = fract( fcSeed * 7.31 + 0.13 );
float fcS2 = fract( fcSeed * 13.17 + 0.71 );
float fcS3 = fract( fcSeed * 29.93 + 0.37 );
float fcFloorM = ${pick((f) => v(f.floorM))} * ( 1.0 + ( fcSeed - 0.5 ) * 2.0 * ${pick((f) => v(f.varyFloor))} );
float fcSpacing = ${pick((f) => v(f.spacingM))} * ( 1.0 + ( fcS1 - 0.5 ) * 2.0 * ${pick((f) => v(f.varySpacing))} );
float fcWidth = ${pick((f) => v(f.width))} * ( 1.0 + ( fcS2 - 0.5 ) * 2.0 * ${pick((f) => v(f.varyWidth))} );
float fcHeight = ${pick((f) => v(f.height))};
float fcSill = ${pick((f) => v(f.sill))};
float fcMullion = step( fcS3, ${pick((f) => v(f.mullion))} );
// Storefront walls: the upper floors' grid starts above the shop floor.
float fcShop = step( 0.5, vStorefront );
float fcGroundM = ${v(SHOP_FLOOR_M)} * ( 1.0 + ( fract( fcSeed * 41.3 + 0.17 ) - 0.5 ) * 2.0 * ${v(SHOP_FLOOR_VARY)} );
float fcBase = fcShop * fcGroundM;

float fcWallLen = vFacade.y;
float fcColumns = floor( max( 0.0, fcWallLen - 2.0 * ${v(WALL_MARGIN_M)} ) / fcSpacing );
float fcRows = floor( max( 0.0, vFacade.z - ${v(PARAPET_M)} - fcBase ) / fcFloorM );
float fcCu = ( vFacade.x - 0.5 * ( fcWallLen - fcColumns * fcSpacing ) ) / fcSpacing;
float fcCv = ( vY - fcBase ) / fcFloorM;
float fcDu = fwidth( fcCu );
float fcDv = fwidth( fcCv );

// Across and up are faded separately: a tower's narrow columns blend out
// long before its floors do, and the floor lines are what reads from afar.
float fcAcross = facadeBox( fract( fcCu ), 0.5 - 0.5 * fcWidth, 0.5 + 0.5 * fcWidth, fcDu );
fcAcross *= 1.0 - fcMullion * facadeBox( fract( fcCu ), ${v(0.5 - MULLION)}, ${v(0.5 + MULLION)}, fcDu );
float fcUp = facadeBox( fract( fcCv ), fcSill, fcSill + fcHeight, fcDv );
float fcDetailAcross = 1.0 - smoothstep( ${v(1 / DETAIL_FULL_PX)}, ${v(1 / DETAIL_GONE_PX)}, fcDu );
float fcDetailUp = 1.0 - smoothstep( ${v(1 / DETAIL_FULL_PX)}, ${v(1 / DETAIL_GONE_PX)}, fcDv );
fcAcross = mix( fcWidth - fcMullion * ${v(2 * MULLION)}, fcAcross, fcDetailAcross );
fcUp = mix( fcHeight, fcUp, fcDetailUp );
// The windowed area, antialiased like the panes, and faded with them: once
// a direction's detail is gone, its blank margins go too, or they linger as
// pale one-pixel lines down distant towers' corners.
float fcInside = mix( 1.0, facadeBox( fcCu, 0.0, fcColumns, fcDu ), fcDetailAcross ) * step( 1.0, fcColumns );
fcInside *= mix( 1.0, facadeBox( fcCv, 0.0, fcRows, fcDv ), fcDetailUp ) * step( 1.0, fcRows );
float fcEnabled = vWall * step( ${v(MIN_HEIGHT_M)}, vFacade.z ) * step( ${v(MIN_WALL_M)}, fcWallLen );

// The shop floor: 1 in it, antialiased at its top edge.
float fcBv = vY / fcGroundM;
float fcBdv = fwidth( fcBv );
float fcGround = fcShop * ( 1.0 - smoothstep( 1.0 - fcBdv, 1.0 + fcBdv, fcBv ) );

// Upper floors, kept out of the shop floor (their faded average would
// otherwise spill down into it).
float fcUpperGlass = fcEnabled * fcInside * fcAcross * fcUp * ( 1.0 - fcGround );
diffuseColor.rgb = mix( diffuseColor.rgb, ${pick((f) => vec3(f.glass))}, fcUpperGlass );

// Shopfront bays: whole bays stretched to fill the wall between its
// margins, glass between piers, a bulkhead below and a band above; each
// direction fades to its average with distance, like the windows.
float fcSpan = max( 0.01, fcWallLen - ${v(2 * WALL_MARGIN_M)} );
float fcBayM = ${v(SHOP_BAY_M)} * ( 1.0 + ( fract( fcSeed * 53.7 + 0.41 ) - 0.5 ) * 2.0 * ${v(SHOP_BAY_VARY)} );
float fcBays = max( 1.0, floor( fcSpan / fcBayM + 0.5 ) );
float fcBu = ( vFacade.x - ${v(WALL_MARGIN_M)} ) / fcSpan * fcBays;
float fcBdu = fwidth( fcBu );
float fcPier = ${v(SHOP_PIER_M)} * fcBays / fcSpan;
float fcShopAcrossDetail = 1.0 - smoothstep( ${v(1 / DETAIL_FULL_PX)}, ${v(1 / DETAIL_GONE_PX)}, fcBdu );
float fcShopUpDetail = 1.0 - smoothstep( ${v(1 / DETAIL_FULL_PX)}, ${v(1 / DETAIL_GONE_PX)}, fcBdv );
float fcShopSpan = mix( 1.0, facadeBox( fcBu, 0.0, fcBays, fcBdu ), fcShopAcrossDetail );
float fcShopAcross = mix( 1.0 - fcPier, facadeBox( fract( fcBu ), 0.5 * fcPier, 1.0 - 0.5 * fcPier, fcBdu ), fcShopAcrossDetail );
float fcGlassLo = ${v(SHOP_BULKHEAD_M)} / fcGroundM;
float fcGlassHi = 1.0 - ${v(SHOP_GLASS_GAP_M)} / fcGroundM;
float fcBandLo = 1.0 - ${v(SHOP_BAND[1])} / fcGroundM;
float fcBandHi = 1.0 - ${v(SHOP_BAND[0])} / fcGroundM;
float fcShopUp = mix( fcGlassHi - fcGlassLo, facadeBox( fcBv, fcGlassLo, fcGlassHi, fcBdv ), fcShopUpDetail );
float fcBandUp = mix( fcBandHi - fcBandLo, facadeBox( fcBv, fcBandLo, fcBandHi, fcBdv ), fcShopUpDetail );
float fcShopOn = fcEnabled * fcGround * fcShopSpan;
float fcShopGlass = fcShopOn * fcShopAcross * fcShopUp;
float fcBand = fcShopOn * fcBandUp;
float fcAwning = step( fract( fcSeed * 71.9 + 0.23 ), ${v(AWNING_SHARE)} );
vec3 fcBandColor = mix( diffuseColor.rgb * ${v(FASCIA_SHADE)}, uAwnings[ int( fract( fcSeed * 23.3 + 0.61 ) * 4.999 ) ], fcAwning );
diffuseColor.rgb = mix( diffuseColor.rgb, fcBandColor, fcBand );
diffuseColor.rgb = mix( diffuseColor.rgb, ${vec3(SHOP_GLASS)}, fcShopGlass );

float windowGlass = fcUpperGlass + fcShopGlass;
// Panes that show no reflection at all (FACADE_SPECULAR): everything but a
// glass tower's curtain wall.
float windowMatte = fcUpperGlass * ( fcType == 2 ? 0.0 : 1.0 ) + fcShopGlass;

// Lit windows (windowLight.ts): each window's hash against the share lit
// at this hour for this building's use; color and brightness vary per
// window. Far away, where the pattern has faded to its average, the
// expected glow instead (the share, an average color), so nothing shimmers.
// No branch (this chunk takes derivatives; see facade.test.ts): computed
// always, scaled to nothing by day through uWindowsOn.
int fcUse = fcType == 1 ? 1 : 0;
float fcShare = litShare( fcUse, uHour, uWeekend );
vec3 fcCell = vec3( fcSeed * 113.0, floor( fcCu ), floor( fcCv ) );
float fcLit = step( fcHash( fcCell ), fcShare );
float fcTone = fcHash( fcCell + 17.0 );
float fcCool = fcUse == 0 ? step( fcHash( fcCell + 31.0 ), ${v(COOL_OFFICE_SHARE)} ) : 0.0;
vec3 fcWarm = mix( ${vec3(palette.windowWarm)}, ${vec3(palette.windowSoft)}, fcTone );
vec3 fcColor = mix( fcWarm, ${vec3(palette.windowCool)}, fcCool );
float fcDetail = min( fcDetailAcross, fcDetailUp );
// Blocks of windows: their own detail, from how many pixels a block spans.
float fcBlockU = fcCu / ${v(WINDOW_BLOCK_COLUMNS)};
float fcBlockV = fcCv / ${v(WINDOW_BLOCK_FLOORS)};
float fcBlockDetail = min(
  1.0 - smoothstep( ${v(1 / BLOCK_FULL_PX)}, ${v(1 / BLOCK_GONE_PX)}, fwidth( fcBlockU ) ),
  1.0 - smoothstep( ${v(1 / BLOCK_FULL_PX)}, ${v(1 / BLOCK_GONE_PX)}, fwidth( fcBlockV ) )
);
float fcInPane = clamp( ( fract( fcCv ) - fcSill ) / max( fcHeight, 0.01 ), 0.0, 1.0 );
float fcCeiling = mix( ${v((1 + WINDOW_FOOT) / 2)}, mix( ${v(WINDOW_FOOT)}, 1.0, fcInPane ), fcDetail );
float fcLevel = ( 0.6 + 0.4 * fcHash( fcCell + 53.0 ) ) * fcCeiling * mix( 1.0, ${v(COOL_BOOST)}, fcCool );
vec3 fcAverage = mix( mix( ${vec3(palette.windowWarm)}, ${vec3(palette.windowSoft)}, 0.5 ), ${vec3(palette.windowCool)}, fcUse == 0 ? ${v(COOL_OFFICE_SHARE)} : 0.0 ) * 0.8;
float fcBlockLit = step( fcHash( vec3( fcSeed * 59.0, floor( fcBlockU ), floor( fcBlockV ) ) ), fcShare );
vec3 fcFarColor = mix( ${vec3(palette.windowWarm)}, ${vec3(palette.windowSoft)}, 0.15 ) * 0.8;
vec3 fcFar = mix( fcFarColor * fcShare * ${v(FAR_AVERAGE)}, fcFarColor * mix( fcShare, fcBlockLit, ${v(BLOCK_CONTRAST)} * uWindowsOn ) * ${v(FAR_GLOW)}, fcBlockDetail );
vec3 fcUpperLight = mix( fcFar, fcColor * fcLevel * fcLit, fcDetail );

float fcShopShare = litShare( 2, uHour, uWeekend );
vec3 fcBay = vec3( fcSeed * 71.0, floor( fcBu ), 3.0 );
float fcShopLit = mix( fcShopShare, step( fcHash( fcBay ), fcShopShare ), min( fcShopAcrossDetail, fcShopUpDetail ) );
vec3 fcShopLight = ${vec3(palette.windowSoft)} * fcShopLit;

// Squared: faint through blue hour, while walls are still lit; full by night.
vec3 windowLight = uWindowsOn * uWindowsOn * ( fcUpperGlass * fcUpperLight * ${v(WINDOW_RADIANCE)} + fcShopGlass * fcShopLight * ${v(SHOP_RADIANCE)} );
float windowReflect = fcUpperGlass * ${pick((f) => v(f.reflect))} + fcShopGlass * ${v(SHOP_REFLECT)};
float windowGlint = mix( ${pick((f) => v(f.glint))}, ${v(SHOP_GLINT)}, fcGround );
`

// After roughnessmap_fragment: panes are smoother than the wall.
export const FACADE_ROUGHNESS = /* glsl */ `
roughnessFactor = mix( roughnessFactor, windowGlint, windowGlass );
`

// After lights_physical_fragment: punched windows and shopfronts show no
// specular either, not even the grazing-angle sheen that a rough pane still
// has, which turned sunlit windows seen along a wall pale gray. They read as
// dark openings, as recessed windows do in daylight.
export const FACADE_SPECULAR = /* glsl */ `
material.specularColorBlended *= 1.0 - windowMatte;
material.specularF90 *= 1.0 - windowMatte;
`

// After emissivemap_fragment (normal and vViewPosition are in view space):
// the sky reflected in the panes, weak looking straight on, strong at
// grazing angles (Schlick Fresnel), not lit by the sun.
export const FACADE_REFLECTION = /* glsl */ `
{
  float facing = clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  float fresnel = 0.04 + 0.96 * pow( 1.0 - facing, 5.0 );
  totalEmissiveRadiance += uSkyReflection * fresnel * windowReflect;
  totalEmissiveRadiance += windowLight;
}
`

// Buildings at middle distance (extrude.ts extrudePrisms, Buildings.tsx):
// no window pattern, only what FACADE_COLOR fades to there. Across a wall
// the windows are always their average; up it, the floor lines stay while
// they're a few pixels or more; at night blocks of WINDOW_BLOCK_FLOORS
// floors light at the lit share, columns taken along the wall's ground
// position (there is no wall coordinate). Shop floors are left out. Sets
// what FACADE_COLOR sets, for the same later chunks. Needs vPrism
// (extrudePrisms' prism), vY, vWall and vGround.
export const FACADE_AVERAGE_PARS = /* glsl */ `
uniform vec3 uSkyReflection;
uniform vec3 uStoneColors[3];
uniform vec3 uPaleStone;
uniform vec3 uGranite;
uniform float uWindowsOn;
uniform float uHour;
uniform float uWeekend;
float fcHash( vec3 p ) {
  return fract( sin( dot( p, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
}
${LIT_SHARE_GLSL}
float facadeBox( float x, float lo, float hi, float aa ) {
  return smoothstep( lo - aa, lo + aa, x ) * ( 1.0 - smoothstep( hi - aa, hi + aa, x ) );
}
`

// After the wall's base color is in diffuseColor.rgb; `fcCI` and `fcMat`
// (the building's colorIndex and pinned material) declared before it.
export const FACADE_AVERAGE = /* glsl */ `
float fcSeed = vPrism.w;
float fcHeightM = vPrism.z;
float fcFamily = floor( ( fcCI + 0.5 ) / 3.0 );
float fcPinned = step( 0.5, fcMat );
float fcTower = max( step( 1.5, fcFamily ), fcPinned );
float fcRandomStone = step( fract( fcSeed * ${v(STONE_HASH[0])} + ${v(STONE_HASH[1])} ), ${v(STONE_TOWER_SHARE)} );
float fcStone = fcTower * mix( fcRandomStone, step( ${v(PINNED_STONE_FROM)}, fcMat ), fcPinned );
int fcType = fcStone > 0.5 ? ${STONE_TOWER} : fcTower > 0.5 ? 2 : int( fcFamily );
vec3 fcStoneColor = fcMat > ${v(PinnedMaterial.Granite - 0.5)} ? uGranite : fcMat > ${v(PinnedMaterial.PaleStone - 0.5)} ? uPaleStone : uStoneColors[ int( mod( fcCI + 0.5, 3.0 ) ) ];
diffuseColor.rgb = mix( diffuseColor.rgb, fcStoneColor, fcStone );
float fcS1 = fract( fcSeed * 7.31 + 0.13 );
float fcS2 = fract( fcSeed * 13.17 + 0.71 );
float fcS3 = fract( fcSeed * 29.93 + 0.37 );
float fcFloorM = ${pick((f) => v(f.floorM))} * ( 1.0 + ( fcSeed - 0.5 ) * 2.0 * ${pick((f) => v(f.varyFloor))} );
float fcSpacing = ${pick((f) => v(f.spacingM))} * ( 1.0 + ( fcS1 - 0.5 ) * 2.0 * ${pick((f) => v(f.varySpacing))} );
float fcWidth = ${pick((f) => v(f.width))} * ( 1.0 + ( fcS2 - 0.5 ) * 2.0 * ${pick((f) => v(f.varyWidth))} );
float fcHeight = ${pick((f) => v(f.height))};
float fcSill = ${pick((f) => v(f.sill))};
float fcMullion = step( fcS3, ${pick((f) => v(f.mullion))} );
float fcRows = floor( max( 0.0, fcHeightM - ${v(PARAPET_M)} ) / fcFloorM );
float fcCv = vY / fcFloorM;
float fcDv = fwidth( fcCv );
float fcDetailUp = 1.0 - smoothstep( ${v(1 / DETAIL_FULL_PX)}, ${v(1 / DETAIL_GONE_PX)}, fcDv );
float fcUp = mix( fcHeight, facadeBox( fract( fcCv ), fcSill, fcSill + fcHeight, fcDv ), fcDetailUp );
float fcInside = mix( 1.0, facadeBox( fcCv, 0.0, fcRows, fcDv ), fcDetailUp ) * step( 1.0, fcRows );
float fcEnabled = vWall * step( ${v(MIN_HEIGHT_M)}, fcHeightM );
float fcUpperGlass = fcEnabled * fcInside * ( fcWidth - fcMullion * ${v(2 * MULLION)} ) * fcUp;
diffuseColor.rgb = mix( diffuseColor.rgb, ${pick((f) => vec3(f.glass))}, fcUpperGlass );
float windowGlass = fcUpperGlass;
float windowMatte = fcUpperGlass * ( fcType == 2 ? 0.0 : 1.0 );
int fcUse = fcType == 1 ? 1 : 0;
float fcShare = litShare( fcUse, uHour, uWeekend );
float fcBlockU = dot( vGround, vec2( 0.7071 ) ) / ( fcSpacing * ${v(WINDOW_BLOCK_COLUMNS)} );
float fcBlockV = fcCv / ${v(WINDOW_BLOCK_FLOORS)};
float fcBlockDetail = min(
  1.0 - smoothstep( ${v(1 / BLOCK_FULL_PX)}, ${v(1 / BLOCK_GONE_PX)}, fwidth( fcBlockU ) ),
  1.0 - smoothstep( ${v(1 / BLOCK_FULL_PX)}, ${v(1 / BLOCK_GONE_PX)}, fwidth( fcBlockV ) )
);
float fcBlockLit = step( fcHash( vec3( fcSeed * 59.0, floor( fcBlockU ), floor( fcBlockV ) ) ), fcShare );
vec3 fcFarColor = mix( ${vec3(palette.windowWarm)}, ${vec3(palette.windowSoft)}, 0.15 ) * 0.8;
vec3 fcFar = mix( fcFarColor * fcShare * ${v(FAR_AVERAGE)}, fcFarColor * mix( fcShare, fcBlockLit, ${v(BLOCK_CONTRAST)} * uWindowsOn ) * ${v(FAR_GLOW)}, fcBlockDetail );
vec3 windowLight = uWindowsOn * uWindowsOn * fcUpperGlass * fcFar * ${v(WINDOW_RADIANCE)};
float windowReflect = fcUpperGlass * ${pick((f) => v(f.reflect))};
float windowGlint = ${pick((f) => v(f.glint))};
`
