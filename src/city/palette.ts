// The City Pulse dusk palette. Every scene color comes from here so the look
// can be tuned in one place. Values are sRGB hex.

export const palette = {
  // Sky and fog share a color so the city dissolves into it with no seam.
  sky: '#1b1e30',

  ground: '#20233a',
  neighborhood: '#272b45', // the three neighborhoods, lifted slightly off the ground

  building: '#9b9cb6', // cool neutral grey; roofs take the sky's blue, west walls the sun's orange
  buildingBase: '#4a4762', // street-level tone; walls brighten toward the roof

  streetMajor: '#7a83b8',
  streetMinor: '#545c8c',
  streetLocal: '#3a4068',

  // Muni vehicles: unlit, so they read as lights moving through the dusk.
  muniBus: '#ffcf7a',
  muniRail: '#7fe8ff', // light rail and streetcars (route_type 0)
  muniCable: '#ff9fc4', // cable cars (route_type 5)
  muniStale: '#5a5f86', // what a bus fades toward once its data is ~3 min old: it recedes into the streets

  sun: '#ffb487', // low sunset key light
  skyFill: '#7d8cc4', // hemisphere fill from above: what lights the roofs at dusk
  groundFill: '#2a2236', // hemisphere bounce from below
} as const
