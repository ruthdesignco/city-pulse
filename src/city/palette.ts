// The City Pulse golden-hour palette. Every scene color comes from here so
// the look can be tuned in one place. Values are sRGB hex.

export const palette = {
  // Fog and the ring/near-camera dim target (Buildings.tsx, Streets.tsx)
  // share this pale, desaturated haze tone -- atmospheric perspective: the
  // ring should recede (hazier, lower contrast), not become the brightest,
  // most vivid thing in frame, which a fully-saturated sky color did. The
  // rendered background itself is the HDRI texture, not this color.
  sky: '#cdc0ac',

  // Warm neutral daylight ground -- dark enough that streetLocal (#404671,
  // the darkest street color) still reads clearly on top of it.
  ground: '#3d342a',
  neighborhood: '#4a3f33', // the three neighborhoods, lifted slightly off the ground

  // A notch below mid grey so the buses, not the buildings, are the brightest
  // thing in the scene. Three color families by OSM building type/height,
  // each with 3 deterministic per-building shade variants
  // (scripts/lib/buildingColor.ts: BuildingColorType*3 + buildingVariant
  // indexes this flat array) -- 92% of buildings carry no usable `building`
  // tag value, so without per-building variety within Neutral especially,
  // the city reads as one flat grey. Subtle -- SF's actual palette (cream,
  // sandstone, muted pastels, grays) -- not a rainbow: every variant stays
  // close enough in value that bloom and the ring-fade/near-dim shader math
  // hold the same way for all nine.
  building: '#8a8ba5', // = buildingColors[0]: kept as the material's fallback color
  buildingColors: [
    '#8a8ba5', // Neutral 0: cool grey (unchanged from the original single color)
    '#9c9686', // Neutral 1: warm taupe-grey
    '#b8a888', // Neutral 2: muted sandstone
    '#c9ab80', // Residential 0: sandstone
    '#d4bb95', // Residential 1: light cream
    '#b89a8c', // Residential 2: dusty pastel terracotta
    '#93a0b4', // Tower 0: glass grey
    '#a6b0bf', // Tower 1: light glass
    '#7e8da3', // Tower 2: deep blue-glass
  ],
  buildingBase: '#423f58', // street-level tone; walls brighten toward the roof

  // 20% brighter (in linear light) than the first pass, once the ring dimming
  // and bloom made them read too faint.
  streetMajor: '#858ec8',
  streetMinor: '#5c6498',
  streetLocal: '#404671',

  // Muni vehicles: unlit, so they read as lights against the daylight scene.
  muniBus: '#ffcf7a',
  muniRail: '#7fe8ff', // light rail and streetcars (route_type 0)
  muniCable: '#ff9fc4', // cable cars (route_type 5)
  // What a bus fades to once its data is ~3 min old: a muted lavender grey,
  // dimmer than any live vehicle and without their glow, but brighter than
  // every street, so a stale bus never reads as a missing one (palette.test.ts).
  muniStale: '#a7adcf',

  // Golden-hour key light. The HDRI sky (Atmosphere.tsx) now provides the
  // ambient/fill lighting that skyFill/groundFill used to; this directional
  // light exists to cast crisp, real shadows in the same warm direction.
  sun: '#ff9c5c',
} as const
