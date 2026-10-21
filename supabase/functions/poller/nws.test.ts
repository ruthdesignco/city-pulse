import { describe, expect, it } from 'vitest'
import { decodeObservations } from './nws.ts'

describe('decodeObservations', () => {
  it('converts units, keeps only known cloud amounts, and drops reports without a time', () => {
    const rows = decodeObservations(
      {
        features: [
          {
            properties: {
              timestamp: '2026-10-20T23:15:00+00:00',
              textDescription: ' Mostly Clear ',
              visibility: { unitCode: 'wmoUnit:m', value: 16093.44 },
              cloudLayers: [
                { amount: 'FEW', base: { unitCode: 'wmoUnit:m', value: 1828.8 } },
                { amount: 'XYZ', base: { unitCode: 'wmoUnit:m', value: 10 } },
                { amount: 'CLR', base: { unitCode: 'wmoUnit:m', value: null } },
              ],
              windSpeed: { unitCode: 'wmoUnit:km_h-1', value: 18.504 },
              windDirection: { unitCode: 'wmoUnit:degree_(angle)', value: 300 },
              windGust: { unitCode: 'wmoUnit:furlongs', value: 9 },
            },
          },
          { properties: { timestamp: 'not a time' } },
          { properties: { timestamp: '2026-10-20T23:20:00Z', visibility: { unitCode: 'wmoUnit:m', value: null } } },
        ],
      },
      'KSFO',
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      station: 'KSFO',
      observed_at: '2026-10-20T23:15:00.000Z',
      visibility_m: 16093.44,
      cloud_layers: [
        { amount: 'FEW', base_m: 1828.8 },
        { amount: 'CLR', base_m: null },
      ],
      wind_speed_ms: expect.closeTo(5.14, 2),
      wind_dir_deg: 300,
      wind_gust_ms: null, // an unknown unit is dropped, not guessed
      description: 'Mostly Clear',
    })
    expect(rows[1]).toMatchObject({ visibility_m: null, cloud_layers: [], wind_speed_ms: null, description: null })
  })

  it('throws on a body that is not a feature collection', () => {
    expect(() => decodeObservations({ status: 503 }, 'KSFO')).toThrow(/no features/)
  })
})
