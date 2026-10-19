// The City Pulse palette. Every scene color comes from here so the look can
// be tuned in one place. Values are sRGB hex.

export const palette = {
  // Fog, the ring/near-camera dim target (Buildings.tsx, Streets.tsx), and
  // SkyDome's horizon color (Atmosphere.tsx) all share this tone -- the
  // fogged ground and the sky dome meet with no seam by construction, since
  // SkyDome is given this exact value, not a close guess. Warm but
  // deliberately NOT vivid: pulled back from earlier, more saturated
  // orange-tan passes toward something closer to neutral.
  sky: '#c7b49c',
  skyZenith: '#aec4da', // SkyDome's upper-frame color: soft pale blue, not warm

  // Clean warm-neutral ground, dark enough that streetLocal (#404671, the
  // darkest street color) still reads on top of it.
  ground: '#483f35',
  neighborhood: '#564c40', // the three neighborhoods, lifted slightly off the ground

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

  // Warm key light, also driving SkyDome's sun glow and (tinted toward
  // ground) the hemisphere fill (Atmosphere.tsx). Pulled back from earlier,
  // more saturated orange passes to a paler gold -- "warm but neutral,"
  // so it tints the scene without washing out buildingColors' variety.
  sun: '#ffd9a8',
} as const
