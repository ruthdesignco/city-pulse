import { describe, expect, it } from 'vitest'
import { ORIGIN, createProjection, toLatLng, toScene } from './projection.ts'

const deg = Math.PI / 180

// Independent reference: the standard series for the length of one degree on
// the WGS84 ellipsoid (as published by NGA). Deliberately a different formula
// from the radii-of-curvature form used in projection.ts.
function refMetersPerDegLat(latDeg: number): number {
  const p = latDeg * deg
  return 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p) - 0.0023 * Math.cos(6 * p)
}
function refMetersPerDegLng(latDeg: number): number {
  const p = latDeg * deg
  return 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p)
}

describe('projection', () => {
  it('maps the origin to (0, 0)', () => {
    const p = toScene(ORIGIN.lat, ORIGIN.lng)
    expect(p.x).toBeCloseTo(0, 9)
    expect(p.z).toBeCloseTo(0, 9)
  })

  it('points east along +x and north along -z (three.js, y up)', () => {
    const east = toScene(ORIGIN.lat, ORIGIN.lng + 0.001)
    const north = toScene(ORIGIN.lat + 0.001, ORIGIN.lng)
    expect(east.x).toBeGreaterThan(0)
    expect(east.z).toBeCloseTo(0, 9)
    expect(north.z).toBeLessThan(0)
    expect(north.x).toBeCloseTo(0, 9)
  })

  it('matches the reference length of a degree at the origin to within 0.01%', () => {
    const { metersPerDegLat, metersPerDegLng } = createProjection(ORIGIN)
    expect(Math.abs(metersPerDegLat / refMetersPerDegLat(ORIGIN.lat) - 1)).toBeLessThan(1e-4)
    expect(Math.abs(metersPerDegLng / refMetersPerDegLng(ORIGIN.lat) - 1)).toBeLessThan(1e-4)
  })

  it('keeps scale error under 0.1% at the edge of the cluster plus context ring', () => {
    // ~3.5 km north of the origin, beyond the farthest building we bake.
    const edgeLat = ORIGIN.lat + 0.032
    const a = toScene(edgeLat, ORIGIN.lng)
    const b = toScene(edgeLat, ORIGIN.lng + 0.01)
    const trueEastWest = refMetersPerDegLng(edgeLat) * 0.01
    expect(Math.abs((b.x - a.x) / trueEastWest - 1)).toBeLessThan(1e-3)
  })

  it('round-trips scene meters back to lat/lng', () => {
    const samples = [
      { lat: 37.7897, lng: -122.3972 }, // Salesforce Tower (approx.)
      { lat: 37.7837, lng: -122.4142 }, // Tenderloin
      { lat: 37.7599, lng: -122.4148 }, // Mission
    ]
    for (const s of samples) {
      const { x, z } = toScene(s.lat, s.lng)
      const back = toLatLng(x, z)
      expect(back.lat).toBeCloseTo(s.lat, 10)
      expect(back.lng).toBeCloseTo(s.lng, 10)
    }
  })

  it('keeps every cluster coordinate small enough for float32 at millimetre precision', () => {
    // float32 has a 24-bit mantissa: at |v| < 8192 m the step is under 1 mm.
    const corners = [
      toScene(37.795, -122.43),
      toScene(37.795, -122.38),
      toScene(37.745, -122.43),
      toScene(37.745, -122.38),
    ]
    for (const c of corners) {
      expect(Math.abs(c.x)).toBeLessThan(8192)
      expect(Math.abs(c.z)).toBeLessThan(8192)
      expect(Math.abs(Math.fround(c.x) - c.x)).toBeLessThan(0.001)
    }
  })
})
