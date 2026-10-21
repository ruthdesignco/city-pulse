import { describe, expect, it } from 'vitest'
import { LIT_SHARE, LIT_SHARE_GLSL, WindowUse, litShare } from './windowLight.ts'

describe('lit window shares', () => {
  it('keeps offices mostly dark late and residences lit in the evening', () => {
    expect(litShare(WindowUse.Office, 1)).toBeLessThan(0.1)
    expect(litShare(WindowUse.Office, 23)).toBeLessThan(0.15)
    expect(litShare(WindowUse.Residential, 21)).toBeGreaterThan(0.5)
    expect(litShare(WindowUse.Residential, 21)).toBeGreaterThan(litShare(WindowUse.Office, 21))
    expect(litShare(WindowUse.Storefront, 19)).toBeGreaterThan(litShare(WindowUse.Storefront, 23))
  })

  it('keeps the city dark before dawn and lets offices fill in through 09:00', () => {
    // Before dawn, offices are no more lit than late in the evening.
    expect(litShare(WindowUse.Office, 7)).toBeLessThanOrEqual(litShare(WindowUse.Office, 22))
    expect(litShare(WindowUse.Office, 6.5)).toBeLessThan(0.1)
    expect(litShare(WindowUse.Office, 9)).toBeGreaterThan(0.5)
    for (let h = 5; h < 10; h += 0.25) expect(litShare(WindowUse.Office, h + 0.25)).toBeGreaterThanOrEqual(litShare(WindowUse.Office, h))
    // A modest residential bump at breakfast, well under the evening.
    expect(litShare(WindowUse.Residential, 7)).toBeGreaterThan(litShare(WindowUse.Residential, 4))
    expect(litShare(WindowUse.Residential, 7)).toBeGreaterThan(litShare(WindowUse.Residential, 10))
    expect(litShare(WindowUse.Residential, 7)).toBeLessThan(litShare(WindowUse.Residential, 21) / 2)
    // Shops shut before 08:00.
    expect(litShare(WindowUse.Storefront, 7)).toBeLessThan(0.15)
  })

  it('wraps at midnight and interpolates between table hours', () => {
    for (const use of [WindowUse.Office, WindowUse.Residential, WindowUse.Storefront]) {
      expect(LIT_SHARE[use][0]).toBe(LIT_SHARE[use][24])
      expect(litShare(use, 24)).toBeCloseTo(litShare(use, 0), 6)
      expect(LIT_SHARE[use]).toHaveLength(25)
      expect(litShare(use, 19.5)).toBeCloseTo((LIT_SHARE[use][19] + LIT_SHARE[use][20]) / 2, 6)
    }
  })

  it('stays a share', () => {
    for (const row of Object.values(LIT_SHARE))
      for (const v of row) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
  })

  it('generates the shader from the same table', () => {
    expect(LIT_SHARE_GLSL).toContain(LIT_SHARE[WindowUse.Residential].map((x) => x.toFixed(3)).join(', '))
  })
})
