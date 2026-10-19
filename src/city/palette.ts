// The City Pulse palette. Every scene color comes from here so the look can
// be tuned in one place. Values are sRGB hex.

export const palette = {
  // Fog, the ring/near-camera dim target (Buildings.tsx, Streets.tsx), and
  // the sky background's horizon color (Atmosphere.tsx, skyBackground.ts)
  // all share this tone -- the fogged ground and the sky meet with no seam
  // by construction. Pulled further toward neutral than the first pass
  // (R/G/B closer together): mostly-neutral haze, warm only at the very
  // edges, not an overall tan wash.
  sky: '#c2bdae',
  skyZenith: '#8fb2d6', // sky background's upper-frame color: a real pale blue, not a tint of the horizon tan

  // The ground beyond the baked city: San Francisco carries on past the
  // context ring, so this is the hazy urban tone the ring's paving fades to
  // (paving.ts: sidewalk mixed ~85% toward sky), not bare earth -- no seam
  // or halo where the ring ends, and it melts into the fog and sky.
  ground: '#c0bbac',

  // The Bay (Ground.tsx) and the East Bay hills beyond it: pale, closer to
  // `skyZenith` than `ground`, so both read as "distance" even before fog
  // finishes fading them -- water and far land already look closer to sky
  // color than solid ground does, even up close.
  bay: '#93aebe',
  hills: '#9aa7ad',


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
  buildingBase: '#4a4238', // street-level tone; walls brighten toward the roof

  // Roads (Streets.tsx, roads.ts) and paving (paving.ts): mid-gray asphalt,
  // lighter concrete for sidewalks and everything else between the
  // buildings, worn off-white lane lines. Lit to render as these values
  // (scene/lighting.ts; check with npm run calibrate).
  asphalt: '#666668',
  sidewalk: '#b4b0a7',
  laneMarking: '#d6d3ca',

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

  // The directional light's color and the sky background's sun-glow accent
  // (Atmosphere.tsx, skyBackground.ts). The sky fill light's color is solved
  // from it (scene/lighting.ts) so sunlit ground comes out neutral, and this
  // warmth only shows on faces the sun actually hits. A pale gold: the more
  // saturated the sun, the bluer the solved sky fill and the bluer every
  // shadow.
  sun: '#fff0dc',
} as const
