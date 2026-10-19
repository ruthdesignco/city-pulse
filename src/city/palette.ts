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

  // Mid-gray asphalt, not near-black: dark enough that streetLocal
  // (#404671, the darkest street color) still reads on top of it, light
  // enough that it doesn't read as a near-black void next to the fogged
  // ground further out (the gap between the two was the "dark band" bug).
  ground: '#6b6862',
  neighborhood: '#78746b', // the three neighborhoods, lifted slightly off the ground

  // The Bay (Ground.tsx) and the East Bay hills beyond it: pale, closer to
  // `skyZenith` than `ground`, so both read as "distance" even before fog
  // finishes fading them -- water and far land already look closer to sky
  // color than solid ground does, even up close.
  bay: '#93aebe',
  hills: '#9aa7ad',

  // Hemisphere light's "sky" (upward ambient fill) term -- kept distinct
  // from `sun` deliberately: `sun` is the directional light's color, so
  // warmth from it only shows on faces it actually hits; this ambient term
  // lights every upward surface uniformly, so keeping it near-neutral stops
  // shadowed/ambient-only areas from reading as uniformly sepia-tinted.
  ambient: '#d8d3c7',

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

  // 20% brighter (in linear light) than the first pass, once the ring dimming
  // and bloom made them read too faint.
  streetMajor: '#858ec8',
  streetMinor: '#5c6498',
  streetLocal: '#404671',

  // Muni vehicles: unlit, so they read as lights against the daylight scene.
  // Boosted from the dusk-era values -- against a bright warm city these
  // need more separation to still read as the brightest, most saturated
  // things in frame.
  muniBus: '#ffb340',
  muniRail: '#5ad6ff', // light rail and streetcars (route_type 0)
  muniCable: '#ff8fc4', // cable cars (route_type 5)
  // What a bus fades to once its data is ~3 min old: a muted lavender grey,
  // dimmer than any live vehicle and without their glow, but brighter than
  // every street, so a stale bus never reads as a missing one (palette.test.ts).
  muniStale: '#a7adcf',

  // Vehicle models (vehicleModels.ts): lit like the buildings, generic
  // liveries, no operator branding. The accent band (and the headlamps) takes
  // the vehicle's color above -- amber bus, cyan rail -- so models, markers
  // and trails share one color code. Cable cars are natural wood instead,
  // their accent a warm lamp glow rather than muniCable's pink.
  liveryBody: '#e9e6df', // off-white bus body
  liveryRail: '#c9ced4', // brushed silver light rail body
  liveryGlass: '#2b333d',
  liverySkirt: '#55585d',
  liveryRoof: '#b3b6ba',
  liveryJoint: '#3b3d41', // articulation bellows
  liveryWheel: '#25272a',
  cableWood: '#b37a45',
  cableWoodDark: '#6e4728',
  cableRoof: '#5f5951',
  cableLamp: '#ffcf87',

  // The directional light's color and the sky background's sun-glow accent
  // (Atmosphere.tsx, skyBackground.ts) -- NOT hemisphereLight's ambient
  // term anymore (see `ambient` above), so this warmth only shows on faces
  // the light actually hits, not as a uniform tint over everything. Pulled
  // back further toward pale gold than the first pass, which still read as
  // an overall sepia wash even after the ambient split.
  sun: '#ffe6c4',
} as const
