import { describe, expect, it } from 'vitest'
import { hasWebGL } from './webgl.ts'

describe('hasWebGL', () => {
  it('is true when webgl2 is available', () => {
    expect(hasWebGL((t) => (t === 'webgl2' ? {} : null))).toBe(true)
  })

  it('is true when only webgl (not webgl2) is available', () => {
    expect(hasWebGL((t) => (t === 'webgl' ? {} : null))).toBe(true)
  })

  it('is false when neither context can be created', () => {
    expect(hasWebGL(() => null)).toBe(false)
  })

  it('asks for a context without a major performance caveat (no software rendering)', () => {
    const asked: unknown[] = []
    hasWebGL((_, options) => {
      asked.push(options)
      return {}
    })
    expect(asked[0]).toEqual({ failIfMajorPerformanceCaveat: true })
  })

  it('is false when getContext throws (blocked or disabled WebGL)', () => {
    expect(
      hasWebGL(() => {
        throw new Error('WebGL is disabled')
      }),
    ).toBe(false)
  })
})
