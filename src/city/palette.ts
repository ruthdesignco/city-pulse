// The City Pulse golden-hour palette. Every scene color comes from here so
// the look can be tuned in one place. Values are sRGB hex.

export const palette = {
  // Fog and the ring/near-camera dim target (Buildings.tsx, Streets.tsx)
  // share this bright warm tone, matching the HDRI sky's horizon haze
  // (Atmosphere.tsx) -- the rendered background itself is the HDRI texture,
  // not this color, but buildings/streets still fade toward it at the ring
  // edge and near the camera, so it has to read as "distant bright haze,"
  // not "distant darkness," under daylight.
  sky: '#f4c892',

  ground: '#20233a',
  neighborhood: '#272b45', // the three neighborhoods, lifted slightly off the ground

  // A notch below mid grey so the buses, not the buildings, are the brightest
  // thing in the scene.
  building: '#8a8ba5', // cool neutral grey; ring/near-camera fade pulls it toward the warm sky haze
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
