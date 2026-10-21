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
  // The Bay at night: dark blue-black (its daytime gray-green, dimmed, reads
  // muddy olive), lit only by the faint city glow (BayWater.tsx).
  bayNight: '#0a1424',

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
  // Storefront awning lines (facade.ts): muted canvas, the colors real
  // awnings fade to -- forest, oxblood, navy, khaki, black.
  awnings: ['#4f5d4a', '#6e3a33', '#3d4a5c', '#8c7a5e', '#2f3133'],
  // Rooftop detail (rooftops.ts, Rooftops.tsx): galvanized HVAC units;
  // penthouses take their building's color. Water tanks are weathered
  // redwood on a dark steel stand.
  roofHvac: '#9c9e9a',
  roofTankWood: '#7a5c42',
  roofTankRoof: '#5a4a3c',
  roofTankStand: '#3e3a36',
  buildingBase: '#4a4238', // street-level tone; walls brighten toward the roof

  // Roads (Streets.tsx, roads.ts) and paving (paving.ts): mid-gray asphalt,
  // lighter concrete for sidewalks and everything else between the
  // buildings, worn off-white lane lines. Lit to render as these values
  // (scene/lighting.ts; check with npm run calibrate).
  asphalt: '#666668',
  sidewalk: '#b4b0a7',
  laneMarking: '#d6d3ca',

  // Street trees (Trees.tsx), by treeSpecies.ts TreeTone: natural, muted
  // greens, each tree shifted slightly from its family's value. Bright is
  // the soft gray-green of a London plane, the commonest street tree here,
  // and sets the look; deep for glossy evergreens (fig, magnolia, Brisbane
  // box), only a little darker; gray-green for eucalypts, olives and tea
  // trees; palms a touch yellower. Trunks one warm gray-brown.
  treeGreens: ['#7d8a66', '#687a5c', '#848e7b', '#808a5e'],
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

  // Time of day (skyState.ts). The sun's color by height: near white at
  // midday, palette.sun's gold at ~16 deg (the old fixed look), deep orange
  // at the horizon.
  sunHigh: '#fff7ec',
  sunLow: '#ffc58f',
  // The sky fill as the sun goes: a cool blue at dusk, a deeper blue at
  // night. At night the ground bounce turns faintly warm, standing in for
  // the city's own streetlight glow (no streetlights are modeled).
  twilightFill: '#a6afc4',
  nightFill: '#878e9c',
  nightBounce: '#878a92',
  // Moonlight: cool, dim (its level comes from skyState.ts's night exposure).
  moonlight: '#b6c1d2',
  // The night sky the dome blends to (SkyDome.tsx): deep blue overhead, a
  // faint warm-violet city glow at the horizon, which the fog and the ring's
  // haze then follow.
  nightSkyZenith: '#0b1424',
  nightSkyHorizon: '#2f3649',
  // Blue hour, on the way there: a clear deep blue overhead, a cool
  // blue-gray horizon, and a warm afterglow only toward where the sun set.
  twilightSkyZenith: '#1d3d7c',
  twilightSkyHorizon: '#7d90b6',
  twilightGlow: '#f0a06a',
  // Lit windows at night (facade.ts): warm 2700-3500 K whites, and a cooler
  // LED white for some offices. Emitted, not lit; no bloom.
  windowWarm: '#ffc985',
  windowSoft: '#ffe2b8',
  windowCool: '#c4d8ff',

  // Weather (weather.ts, skyState.ts). The marine layer's color (heightFog.ts):
  // a bright gray-white by day, scaled with the light; at night the dim
  // orange-gray of fog lit from below by the city, bright enough that the
  // fog itself reads against the dark.
  fogDay: '#e2e5e8',
  fogNight: '#66615b',
  // Light under full overcast by day (skyState.ts): the fill's cool white
  // and a neutral gray ground bounce.
  overcastLight: '#d0dcee',
  overcastBounce: '#979ca4',
  // An overcast sky (SkyDome.tsx): flat gray-white, a little brighter
  // overhead; at night low clouds over San Francisco glow a dim gray from
  // the city below, far brighter than a clear night sky.
  overcastZenith: '#d0d8e2',
  overcastHorizon: '#b9c1cc',
  overcastNightZenith: '#36383b',
  overcastNightHorizon: '#2b2d31',
} as const
