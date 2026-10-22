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
  { id: 'sutro', name: 'Sutro Tower', replaces: ['relation/3829019'] },
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

// The ground a landmark stands on (LandmarkSpec.stand): the lowest under
// its footprint's rectangle, or the ground under its center. The far bake
// records it (farFormat.ts landmarkY) for Landmarks.tsx.
export function landmarkGround(at: LandmarkPlacement, heightAt: (x: number, z: number) => number): number {
  if (LANDMARKS.find((l) => l.id === at.id)?.stand === 'center') return heightAt(at.x, at.z)
  const c = Math.cos(at.angle)
  const s = Math.sin(at.angle)
  let lo = heightAt(at.x, at.z)
  for (const [u, v] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ]) {
    const lx = (u * at.sizeX) / 2
    const lz = (v * at.sizeZ) / 2
    lo = Math.min(lo, heightAt(at.x + lx * c - lz * s, at.z + lx * s + lz * c))
  }
  return lo
}
