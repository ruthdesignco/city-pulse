import { describe, expect, it } from 'vitest'
import { checkSecret } from './auth.ts'

const SECRET = 'synthetic-poller-secret-0123456789'

describe('checkSecret', () => {
  it('accepts the exact secret', async () => {
    expect(await checkSecret(SECRET, SECRET)).toBe('ok')
  })

  it('tolerates surrounding whitespace on either side', async () => {
    expect(await checkSecret(` ${SECRET}\n`, `${SECRET}\n`)).toBe('ok')
  })

  it('rejects a missing or empty header', async () => {
    expect(await checkSecret(null, SECRET)).toBe('unauthorized')
    expect(await checkSecret('', SECRET)).toBe('unauthorized')
    expect(await checkSecret('   ', SECRET)).toBe('unauthorized')
  })

  it('rejects a wrong secret of the same length', async () => {
    const wrong = SECRET.slice(0, -1) + (SECRET.endsWith('9') ? '8' : '9')
    expect(wrong).toHaveLength(SECRET.length)
    expect(await checkSecret(wrong, SECRET)).toBe('unauthorized')
  })

  it('rejects prefixes, extensions and case changes', async () => {
    expect(await checkSecret(SECRET.slice(0, 20), SECRET)).toBe('unauthorized')
    expect(await checkSecret(`${SECRET}x`, SECRET)).toBe('unauthorized')
    expect(await checkSecret(SECRET.toUpperCase(), SECRET)).toBe('unauthorized')
  })

  it('fails closed when POLLER_SECRET is unset, empty or too short', async () => {
    expect(await checkSecret(SECRET, undefined)).toBe('misconfigured')
    expect(await checkSecret('', '')).toBe('misconfigured')
    expect(await checkSecret('short', 'short')).toBe('misconfigured')
    expect(await checkSecret(null, '   ')).toBe('misconfigured')
  })
})
