import { describe, expect, it } from 'vitest'
import { landTones } from './landTexture.ts'

describe('landTones', () => {
  const tones = landTones(64)
  it('averages to exactly the land color, so the paving meets it seamlessly', () => {
    expect(tones.reduce((s, t) => s + t, 0) / tones.length).toBeCloseTo(1, 6)
  })
  it('varies enough to read as city blocks, and never by extremes', () => {
    const min = Math.min(...tones)
    const max = Math.max(...tones)
    expect(max - min).toBeGreaterThan(0.3)
    expect(min).toBeGreaterThan(0.5)
    expect(max).toBeLessThan(1.6)
  })
})
