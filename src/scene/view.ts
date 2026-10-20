// Opening view: about 1.8 km out, looking north-northeast across SoMa (its
// center is near (705, -1165)) to the downtown skyline (Salesforce Tower is at
// about (1416, -2417)). Close enough that a bus is ~20 px and its trail
// several times that; the idle drift orbits around TARGET.
//
// Tilted down like a drone shot: the view direction sits (90 - polar_deg)
// below horizontal (the camera sits on a sphere around TARGET, so this falls
// straight out of the polar angle). With a 40° fov the frame's top edge sits
// 20° above the view direction. At 0.97 (~56° from vertical) the top edge
// sits ~14° below horizontal, landing on ground ~4.3 km out, deep in the
// fog's haze: the frame tops out in distance, with no sky, horizon seam or
// grazing-angle water. The tallest tops fit under it with room to spare
// (Transamerica's, the highest in frame, sits ~85% of the way up the upper
// half). 0.85 cut those tops off at the edge; 1.2 (~69°, horizon just above
// the frame) showed the ground plane's far edge as a hard line under the sky
// and turned the upper third into streaky grazing-angle water.
export const TARGET: [number, number, number] = [950, 100, -1550]
const OPEN_DISTANCE = 1800
const OPEN_POLAR = 0.97 // ~56° from vertical -> view ~34° below horizontal, top edge ~14° below
const OPEN_AZIMUTH = -0.47 // OrbitControls convention: atan2(x, z) of camera minus target; camera south-southwest

export const OPENING_POSITION: [number, number, number] = [
  TARGET[0] + OPEN_DISTANCE * Math.sin(OPEN_POLAR) * Math.sin(OPEN_AZIMUTH),
  TARGET[1] + OPEN_DISTANCE * Math.cos(OPEN_POLAR),
  TARGET[2] + OPEN_DISTANCE * Math.sin(OPEN_POLAR) * Math.cos(OPEN_AZIMUTH),
]

// The orbit's limits (CameraRig.tsx), shared with the scripted shots' tests.
// Down to 150 m so the vehicle models (vehicleModels.ts) can be seen up close;
// at the old 800 m minimum a bus never got past ~20 px.
export const ORBIT_LIMITS = {
  minDistance: 150,
  maxDistance: 6500,
  minPolar: 0.15, // near top-down
  maxPolar: 1.25, // ~72° from vertical: a user drag ceiling, steeper than the opening view's tilt
} as const
