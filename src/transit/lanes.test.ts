import { describe, expect, it } from 'vitest'
import { ROAD_CLASS } from '../city/roads.ts'
import { StreetClass } from '../city/format.ts'
import { CURB_CLEARANCE_M, OFF_STREET, OFF_STREET_OFFSET_M, TRACK_OFFSET_M, curbLaneOffset, laneOffset } from './lanes.ts'
import { MODEL_WIDTH_M } from './fleet.ts'

describe('lane offsets', () => {
  it('puts buses in the curb lane, on their own side of every street', () => {
    expect(curbLaneOffset(StreetClass.Major)).toBeCloseTo(6.75, 9) // 18 m, 4 lanes
    expect(curbLaneOffset(StreetClass.Minor)).toBeCloseTo(3.25, 9) // 13 m, 2 lanes
    expect(curbLaneOffset(StreetClass.Local)).toBeCloseTo(2.25, 9) // 9 m, one each way
    for (const cls of [StreetClass.Major, StreetClass.Minor, StreetClass.Local]) {
      const o = laneOffset('bus60', cls)
      // Clear of the centerline (so opposite directions never touch) and of the curb.
      expect(o - MODEL_WIDTH_M.bus60 / 2).toBeGreaterThan(0)
      expect(o + MODEL_WIDTH_M.bus60 / 2).toBeLessThanOrEqual(ROAD_CLASS[cls].asphaltM / 2 - CURB_CLEARANCE_M + 1e-9)
    }
  })

  it('runs rail and cable cars on tracks either side of the middle', () => {
    expect(laneOffset('rail', StreetClass.Major)).toBe(TRACK_OFFSET_M)
    expect(laneOffset('cable', StreetClass.Local)).toBe(TRACK_OFFSET_M)
  })

  it('never lets the distance scale-up push a vehicle over the curb', () => {
    for (const cls of [StreetClass.Major, StreetClass.Minor, StreetClass.Local])
      for (const scale of [1, 1.5, 2, 3]) {
        const o = laneOffset('bus40', cls, scale)
        expect(o).toBeGreaterThanOrEqual(0)
        expect(o + (MODEL_WIDTH_M.bus40 * scale) / 2).toBeLessThanOrEqual(ROAD_CLASS[cls].asphaltM / 2 - CURB_CLEARANCE_M + 1e-9)
      }
  })

  it('keeps each direction to its own side off the drawn streets too', () => {
    expect(laneOffset('bus40', OFF_STREET)).toBe(OFF_STREET_OFFSET_M)
    expect(laneOffset('rail', OFF_STREET)).toBe(TRACK_OFFSET_M)
    expect(laneOffset('bus40', OFF_STREET) - MODEL_WIDTH_M.bus40 / 2).toBeGreaterThan(0)
  })
})
