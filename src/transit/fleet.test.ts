import { describe, expect, it } from 'vitest'
import { isSixtyFoot, vehicleKind } from './fleet.ts'

describe('isSixtyFoot', () => {
  it('matches the XDE60 and XT60 series, ends included', () => {
    for (const id of ['6500', '6554', '6560', '6697', '6700', '6730', '7201', '7293']) expect(isSixtyFoot(id), id).toBe(true)
  })

  it('leaves 40 ft buses, roster gaps and odd ids alone', () => {
    for (const id of ['5737', '8026', '8962', '6555', '6731', '7200', '7294', '', '6500a', '06500x']) expect(isSixtyFoot(id), id).toBe(false)
  })
})

describe('vehicleKind', () => {
  it('takes rail and cable car from the route type', () => {
    expect(vehicleKind(0, '2001')).toBe('rail')
    expect(vehicleKind(0, '1008')).toBe('rail')
    expect(vehicleKind(5, '12')).toBe('cable')
  })

  it('takes bus length from the fleet number', () => {
    expect(vehicleKind(3, '6612')).toBe('bus60')
    expect(vehicleKind(3, '7230')).toBe('bus60')
    expect(vehicleKind(3, '8850')).toBe('bus40')
    expect(vehicleKind(11, '5801')).toBe('bus40')
    expect(vehicleKind(undefined, '6612')).toBe('bus60')
  })
})
