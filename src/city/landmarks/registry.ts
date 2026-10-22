// The landmarks drawn as hand-built models instead of their OpenStreetMap
// extrusion: an extruded footprint can't make a pyramid or a fluted tower.
// One builder per landmark in this directory (models.ts lists them); this
// list is what the bake reads (no three.js here), so it can drop each
// one's OSM footprint by ID and record where the model goes
// (the city index's landmarkModels). The bake fails if an ID matches
// nothing, so a remapped OSM way can't silently bring the box back.
//
// To add one (the Ferry Building's clock tower, the Bay Bridge): an entry
// here with the OSM IDs it replaces, and a builder file.

export interface LandmarkSpec {
  id: string
  name: string
  // OSM elements whose building footprints the model replaces, "way/123".
  replaces: string[]
  // An OSM area around it the model also uses (Coit Tower's trees stand in
  // Pioneer Park): its outline is baked with the placement.
  grounds?: string
  // Where it stands on the terrain: on the lowest ground under its
  // footprint (default; nothing floats) or the ground under its center
  // (a hilltop with its own leveled plaza, which the model brings).
  stand?: 'lowest' | 'center'
}

export const LANDMARKS: LandmarkSpec[] = [
  { id: 'transamerica', name: 'Transamerica Pyramid', replaces: ['way/24222973'] },
  { id: 'coit', name: 'Coit Tower', replaces: ['way/28824850'], grounds: 'way/224941774', stand: 'center' },
]

// Where a landmark stands, from its OSM footprint (the bake's
// minimum-area rectangle around it): center, the rectangle's axes turned
// `angle` radians from scene +x (within +-45 deg, so local x is the side
// facing roughly east-west), its size along them, and its ring position
// (0 inside the neighborhoods .. 1 at the ring's edge, ring.ts).
export interface LandmarkPlacement {
  id: string
  x: number
  z: number
  angle: number
  sizeX: number
  sizeZ: number
  ring: number
  // The grounds' outline, scene meters x, z interleaved (rounded to 0.1).
  grounds?: number[]
}
