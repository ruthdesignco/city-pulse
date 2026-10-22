import { describe, expect, it } from 'vitest'
import { StreetClass } from './format.ts'
import { STOREFRONT_SHARE, StreetFrontage, frontageReach, hasStorefront } from './frontage.ts'
import { ROAD_CLASS } from './roads.ts'

// Coordinates in meters. A minor street along x at z = 0, and a local one
// along x at z = 40.
const q = (pts: number[]) => Float32Array.from(pts)
const frontage = new StreetFrontage({
  counts: Uint16Array.from([2, 2]),
  classes: Uint8Array.from([StreetClass.Minor, StreetClass.Local]),
  coords: q([-100, 0, 100, 0, -100, 40, 100, 40]),
})
// A wall along x at depth z, facing -z (toward the minor street when z > 0).
const facingDown = (z: number) => frontage.classOf(10, z, -10, z, 0, -1)

describe('StreetFrontage', () => {
  it('finds a wall that runs along a street, faces it and stands within reach', () => {
    const minor = ROAD_CLASS[StreetClass.Minor]
    expect(facingDown(minor.asphaltM / 2 + minor.sidewalkM)).toBe(StreetClass.Minor)
    expect(facingDown(frontageReach(StreetClass.Minor) - 0.5)).toBe(StreetClass.Minor)
    expect(facingDown(frontageReach(StreetClass.Minor) + 0.5)).toBe(-1)
  })

  it('ignores walls facing away from the street, or across it', () => {
    expect(frontage.classOf(-10, 10, 10, 10, 0, 1)).toBe(-1) // faces the back (+z), toward nothing in reach
    expect(frontage.classOf(10, 5, 10, 15, 1, 0)).toBe(-1) // perpendicular to the street
  })

  it('takes the biggest street a wall fronts', () => {
    // A local and a minor street side by side, the local one listed first;
    // a wall 8 m from the local one is within reach of both.
    const both = new StreetFrontage({
      counts: Uint16Array.from([2, 2]),
      classes: Uint8Array.from([StreetClass.Local, StreetClass.Minor]),
      coords: q([-100, 0, 100, 0, -100, -3, 100, -3]),
    })
    expect(both.classOf(10, 8, -10, 8, 0, -1)).toBe(StreetClass.Minor)
  })
})

describe('hasStorefront', () => {
  // Evenly spread seeds (a small LCG, as facade.test.ts).
  let x = 777
  const seeds = Array.from({ length: 4000 }, () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296)
  const share = (cls: number, family: number) => seeds.filter((s) => hasStorefront(cls, family, s, 20, 20)).length / seeds.length

  it('puts storefronts on most main-street walls, fewer on side streets', () => {
    expect(share(StreetClass.Major, 0)).toBeCloseTo(STOREFRONT_SHARE[StreetClass.Major], 1)
    expect(share(StreetClass.Minor, 1)).toBeCloseTo(STOREFRONT_SHARE[StreetClass.Minor], 1)
    expect(share(StreetClass.Local, 0)).toBeCloseTo(STOREFRONT_SHARE[StreetClass.Local], 1)
  })

  it('never on residential buildings on side streets, walls on no street, low buildings or short walls', () => {
    expect(share(StreetClass.Local, 1)).toBe(0)
    expect(share(-1, 0)).toBe(0)
    expect(seeds.some((s) => hasStorefront(StreetClass.Major, 0, s, 5, 20))).toBe(false)
    expect(seeds.some((s) => hasStorefront(StreetClass.Major, 0, s, 20, 3))).toBe(false)
  })
})
