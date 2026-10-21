import { describe, expect, it } from 'vitest'
import { COORD_QUANTUM, StreetClass } from '../../src/city/format.ts'
import { ROAD_CLASS } from '../../src/city/roads.ts'
import { CURB_INSET_M, CURB_PUSH_MAX_M, FootprintIndex, RoadwayIndex } from './treeSites.ts'

// Coordinates are COORD_QUANTUM units.
const q = (pts: number[]) => Int16Array.from(pts.map((v) => Math.round(v / COORD_QUANTUM)))

describe('FootprintIndex', () => {
  const footprints = new FootprintIndex({
    counts: Uint16Array.from([4]),
    heights: Uint16Array.from([100]),
    ringBand: Uint8Array.from([0]),
    colorIndex: Uint8Array.from([0]),
    seeds: Uint32Array.from([0]),
    coords: q([10, 10, 40, 10, 40, 30, 10, 30]),
  })
  it('finds trunks inside a footprint, including across grid cells', () => {
    expect(footprints.contains(20, 20)).toBe(true)
    expect(footprints.contains(39, 29)).toBe(true)
    expect(footprints.contains(5, 20)).toBe(false)
    expect(footprints.contains(60, 20)).toBe(false)
  })
})

describe('RoadwayIndex', () => {
  // A local street along x (9 m curb to curb), and a cross street along z at x = 100.
  const half = ROAD_CLASS[StreetClass.Local].asphaltM / 2
  const roads = new RoadwayIndex({
    counts: Uint16Array.from([2, 2]),
    classes: Uint8Array.from([StreetClass.Local, StreetClass.Local]),
    coords: q([0, 0, 200, 0, 100, -100, 100, 100]),
  })

  it('measures how far a trunk is onto the asphalt', () => {
    expect(roads.depth(50, 0)).toBeCloseTo(half, 6)
    expect(roads.depth(50, half + 1)).toBeCloseTo(-1, 6)
    expect(roads.onRoadway(50, half - 0.5)).toBe(true)
    expect(roads.onRoadway(50, half + 0.5)).toBe(false)
    expect(roads.depth(20, 60)).toBe(-Infinity) // no street in its grid cell
  })

  it('moves a curbside tree just past the curb, on its own side', () => {
    expect(roads.pushToCurb(50, half + 1, CURB_PUSH_MAX_M, CURB_INSET_M)).toEqual([50, half + 1])
    const [x, z] = roads.pushToCurb(50, -(half - 1), CURB_PUSH_MAX_M, CURB_INSET_M)!
    expect(x).toBeCloseTo(50, 6)
    expect(z).toBeCloseTo(-(half + CURB_INSET_M), 6)
    expect(roads.onRoadway(x, z)).toBe(false)
  })

  it('leaves trees deep in the roadway, or pushed onto another street, where they are', () => {
    expect(roads.pushToCurb(50, half - CURB_PUSH_MAX_M - 0.5, CURB_PUSH_MAX_M, CURB_INSET_M)).toBeNull()
    expect(roads.pushToCurb(50, 0, CURB_PUSH_MAX_M, CURB_INSET_M)).toBeNull()
    // In the intersection: out of one street is still on the other.
    expect(roads.pushToCurb(101, half - 0.5, CURB_PUSH_MAX_M, CURB_INSET_M)).toBeNull()
  })
})
