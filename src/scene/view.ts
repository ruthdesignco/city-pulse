// Opening view: about 1.8 km out, looking north-northeast across SoMa (its
// center is near (705, -1165)) to the downtown skyline (Salesforce Tower is at
// about (1416, -2417)). Close enough that a bus is ~20 px and its trail
// several times that; the idle drift orbits around TARGET.
//
// Tilted down like a drone shot: the view direction sits (90 - polar_deg)
// below horizontal (the camera sits on a sphere around TARGET, so this falls
// straight out of the polar angle). With a 40° fov the frame's top edge sits
// 20° above the view direction. The old OPEN_POLAR (1.2, ~69° from vertical)
// put the top edge right at the horizon -- chasing the ground/sky seam there
// (haze color, hard edges, the Bay reading as a flat plateau) never fully
// resolved, so this tilts down further instead: top edge now sits ~21° below
// horizontal, well past it, so the horizon is cropped out and the city fills
// the frame. TARGET sits at mid-skyline height so the towers aren't cropped.
export const TARGET: [number, number, number] = [950, 100, -1550]
const OPEN_DISTANCE = 1800
const OPEN_POLAR = 0.85 // ~49° from vertical -> view ~41° below horizontal, top edge ~21° below
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
