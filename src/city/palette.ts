// The City Pulse palette. Every scene color comes from here so the look can
// be tuned in one place. Values are sRGB hex.

export const palette = {
  // The haze: the sky's own color at the horizon in the opening view's
  // direction (skyModel.ts horizonColor; skyModel.test.ts keeps them equal).
  // The fog starts here and then follows the sky as the camera turns
  // (SkyDome.tsx); the ring's buildings, streets and paving fade toward it.
  sky: '#bcc2cb',

  // Land beyond the baked city (Ground.tsx): the rest of San Francisco seen
  // from afar, a cool urban gray, clearly darker than the haze so the fog
  // visibly carries it into the sky. The mean of the land's city-block
  // texture (landTexture.ts); the ring's paving blends into it over
  // paving.ts's EDGE_BLEND_M.
  ground: '#8b8e8c',
  // Light bounced up from the ground onto walls and undersides (the
  // hemisphere light's ground color, Atmosphere.tsx). Kept at the land's old
  // warm gray when the land itself went darker and cooler, so no building's
  // shading moved.
  bounce: '#a9a698',

  // The Bay (bay.ts, BayWater.tsx): the muted gray-green of its water. This
  // is Water.js's body color, which it scales by how directly the water is
  // seen (~0.6 from the opening camera) before adding reflection, so it sits
  // brighter than the color that ends up on screen. The fog carries it into
  // the haze further out.
  bay: '#90a69b',

  // Three color families by OSM building type/height, each with 3
  // deterministic per-building shade variants (scripts/lib/buildingColor.ts:
  // BuildingColorType*3 + buildingVariant indexes this flat array) -- 92% of
  // buildings carry no usable `building` tag value, so without per-building
  // variety within Neutral especially, the city reads as one flat color.
  // Realistic San Francisco architecture -- cream and white stucco, warm
  // grays, sandstone, some terracotta, blue-gray glass towers -- bright
  // enough to read clearly (not the desaturated-neutral first pass) but
  // deliberately no greens or teals. Every variant stays close enough in
  // value within its family that bloom and the ring-fade/near-dim shader
  // math hold the same way for all nine.
  building: '#e3d5bc', // = buildingColors[0]: kept as the material's fallback color
  buildingColors: [
    '#e3d5bc', // Neutral 0: cream/white stucco
    '#b8aa94', // Neutral 1: warm gray
    '#cbb896', // Neutral 2: sandstone
    '#c97b56', // Residential 0: terracotta
    '#ecd9b8', // Residential 1: bright stucco cream
    '#d9a876', // Residential 2: warm tan/ochre
    '#9fb0c2', // Tower 0: light blue-gray glass
    '#7891a8', // Tower 1: medium blue-gray glass
    '#c3ccd6', // Tower 2: pale glass
  ],
  // Towers in stone or concrete instead of glass (facade.ts isStoneTower),
  // by the tower's color variant: cream limestone, warm gray concrete, pale
  // sandstone. Same value range as the glass towers they stand among.
  stoneTowerColors: ['#d8ccb6', '#b5ab9c', '#c9bda4'],
  // Pinned landmark stone (scripts/lib/landmarkMaterials.ts): the
  // Transamerica Pyramid's pale crushed-quartz panels, and 555 California
  // Street's dark red-brown carnelian granite.
  landmarkPaleStone: '#e6e1d6',
  landmarkGranite: '#5c4743',
  buildingBase: '#4a4238', // street-level tone; walls brighten toward the roof

  // Roads (Streets.tsx, roads.ts) and paving (paving.ts): mid-gray asphalt,
  // lighter concrete for sidewalks and everything else between the
  // buildings, worn off-white lane lines. Lit to render as these values
  // (scene/lighting.ts; check with npm run calibrate).
  asphalt: '#666668',
  sidewalk: '#b4b0a7',
  laneMarking: '#d6d3ca',

  // Street trees (Trees.tsx), by treeSpecies.ts TreeTone: natural, muted
  // greens, as foliage really is in sun (leaves reflect only ~10-15%), each
  // tree shifted slightly from its family's value. Bright for plane trees,
  // elms, ginkgo and most deciduous trees; deep for glossy evergreens (fig,
  // magnolia, Brisbane box); gray-green for eucalypts, olives and tea trees;
  // palms a touch yellower. Trunks one warm gray-brown.
  treeGreens: ['#65774b', '#4d6440', '#6e7a66', '#6f7849'],
  treeTrunk: '#5e5246',

  // Vehicle models (vehicleModels.ts): lit by the sun like the buildings, in
  // their real body colors at every distance. Generic liveries, no operator
  // branding: off-white buses and silver light rail with a muted stripe,
  // natural wood cable cars.
  liveryBody: '#e9e6df', // off-white bus body
  liveryBusStripe: '#8a3b2f', // muted brick
  liveryRail: '#c9ced4', // brushed silver light rail body
  liveryRailStripe: '#4c6573', // muted slate blue
  liveryGlass: '#2b333d',
  liverySkirt: '#55585d',
  liveryRoof: '#b3b6ba',
  liveryJoint: '#3b3d41', // articulation bellows
  liveryWheel: '#25272a',
  liveryLamp: '#dedbd2', // headlamp lenses, unlit
  cableWood: '#b37a45',
  cableWoodDark: '#6e4728',
  cableRoof: '#5f5951',

  // The directional light's color (Atmosphere.tsx), and the Bay's sun glints
  // (BayWater.tsx). The sky fill light's color is solved
  // from it (scene/lighting.ts) so sunlit ground comes out neutral, and this
  // warmth only shows on faces the sun actually hits. A pale gold: the more
  // saturated the sun, the bluer the solved sky fill and the bluer every
  // shadow.
  sun: '#fff0dc',
} as const
