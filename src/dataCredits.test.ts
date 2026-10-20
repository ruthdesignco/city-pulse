import { describe, expect, it } from 'vitest'
import { ABOUT_VIEW, CREDITS } from './dataCredits.ts'

describe('data credits', () => {
  it("credits OpenStreetMap as ODbL requires", () => {
    expect(CREDITS).toContainEqual({ text: '© OpenStreetMap contributors', href: 'https://www.openstreetmap.org/copyright' })
  })

  it("uses the 511 agreement's required tag line, linked to 511.org (§5.b)", () => {
    const credit = CREDITS.find((c) => /511/.test(c.text))
    expect(credit?.text).toMatch(/^(Data provided by|Powered by) 511\.org$/i)
    expect(new URL(credit!.href).hostname.replace(/^www\./, '')).toBe('511.org')
  })

  it('credits the street trees to SF Public Works via DataSF', () => {
    expect(CREDITS.some((c) => c.text.includes('SF Public Works') && c.text.includes('DataSF'))).toBe(true)
  })
})

describe('about this view', () => {
  it('says which parts are illustrative and that the light is fixed', () => {
    const text = ABOUT_VIEW.join(' ')
    for (const word of ['Illustrative', 'storefronts', 'rooftop', 'materials', '8 m', 'fixed'])
      expect(text).toContain(word)
  })
})
