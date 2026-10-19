// Opening view: about 1.5 km out, looking north-northeast across SoMa (its
// center is near (705, -1165)) to the downtown skyline (Salesforce Tower is at
// about (1416, -2417)). Close enough that a bus is ~25 px and its trail
// several times that; the idle drift orbits around TARGET.
export const TARGET: [number, number, number] = [950, 0, -1550]
const OPEN_DISTANCE = 1500
const OPEN_POLAR = 0.8 // ~46° from vertical
const OPEN_AZIMUTH = -0.47 // OrbitControls convention: atan2(x, z) of camera minus target; camera south-southwest

export const OPENING_POSITION: [number, number, number] = [
  TARGET[0] + OPEN_DISTANCE * Math.sin(OPEN_POLAR) * Math.sin(OPEN_AZIMUTH),
  TARGET[1] + OPEN_DISTANCE * Math.cos(OPEN_POLAR),
  TARGET[2] + OPEN_DISTANCE * Math.sin(OPEN_POLAR) * Math.cos(OPEN_AZIMUTH),
]
