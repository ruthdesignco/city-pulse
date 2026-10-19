import { useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import { Vector3 } from 'three'
import { palette } from '../city/palette.ts'
import { CALIBRATION_CENTER } from './shots.ts'

// ?calibrate (with ?view=calibrate): a grid of flat, upward-facing palette
// swatches high above the city, in full sun with nothing to shadow them, lit
// and tone mapped exactly like the roads. scripts/calibrate.ts reads back
// what each renders as, to check that a sunlit horizontal surface shows
// close to its palette value.
//
// Each frame the swatches' screen positions go to window.__calibration.

// Unlit swatches skip lighting entirely: what they render as is the tone
// mapping and output color space alone.
const UNLIT = new Set(['unlit gray 18%', 'unlit gray 50%'])

const SWATCHES: [string, string][] = [
  ['unlit gray 18%', '#767676'],
  ['unlit gray 50%', '#bcbcbc'],
  ['gray 18%', '#767676'],
  ['gray 50%', '#bcbcbc'],
  ['asphalt', palette.asphalt],
  ['sidewalk', palette.sidewalk],
  ['laneMarking', palette.laneMarking],
  ['ground', palette.ground],
  ['building cream', palette.buildingColors[0]],
  ['building terracotta', palette.buildingColors[3]],
  ['building glass', palette.buildingColors[7]],
  ['bus body', palette.liveryBody],
  ['rail body', palette.liveryRail],
  ['cable wood', palette.cableWood],
]

const SIZE_M = 40
const GAP_M = 12
const COLUMNS = 4

declare global {
  interface Window {
    __calibration?: { name: string; hex: string; x: number; y: number }[]
  }
}

export function Calibration() {
  const placed = useMemo(() => {
    const rows = Math.ceil(SWATCHES.length / COLUMNS)
    const step = SIZE_M + GAP_M
    return SWATCHES.map(([name, hex], i) => {
      const col = i % COLUMNS
      const row = Math.floor(i / COLUMNS)
      const at = new Vector3(
        CALIBRATION_CENTER[0] + (col - (COLUMNS - 1) / 2) * step,
        CALIBRATION_CENTER[1],
        CALIBRATION_CENTER[2] + (row - (rows - 1) / 2) * step,
      )
      return { name, hex, at }
    })
  }, [])
  const scratch = useMemo(() => new Vector3(), [])
  useFrame(({ camera, size }) => {
    window.__calibration = placed.map(({ name, hex, at }) => {
      scratch.copy(at).project(camera)
      return { name, hex, x: ((scratch.x + 1) / 2) * size.width, y: ((1 - scratch.y) / 2) * size.height }
    })
  })

  return (
    <>
      {placed.map(({ name, hex, at }) => (
        <mesh key={name} position={at} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[SIZE_M, SIZE_M]} />
          {UNLIT.has(name) ? <meshBasicMaterial color={hex} /> : <meshStandardMaterial color={hex} roughness={0.95} metalness={0} />}
        </mesh>
      ))}
    </>
  )
}
