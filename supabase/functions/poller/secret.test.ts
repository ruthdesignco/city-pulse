import { describe, expect, it } from 'vitest'
import { MAX_AGE_MS, RELOAD_MS, secretCache } from './secret.ts'

function setup(values: (string | null | Error)[]) {
  const clock = { t: 1_000_000 }
  let loads = 0
  const cache = secretCache(async () => {
    const v = values[Math.min(loads++, values.length - 1)]
    if (v instanceof Error) throw v
    return v
  }, () => clock.t)
  return { cache, clock, loads: () => loads }
}

describe('secretCache', () => {
  it('loads once and serves the cached value until it is MAX_AGE_MS old', async () => {
    const s = setup(['a', 'b'])
    expect(await s.cache.current()).toBe('a')
    s.clock.t += MAX_AGE_MS - 1
    expect(await s.cache.current()).toBe('a')
    expect(s.loads()).toBe(1)
    s.clock.t += 1
    expect(await s.cache.current()).toBe('b')
    expect(s.loads()).toBe(2)
  })

  it('reloads on request, at most once per RELOAD_MS', async () => {
    const s = setup(['a', 'b', 'c'])
    await s.cache.current()
    expect(await s.cache.reloaded()).toBe('a') // just loaded: throttled
    s.clock.t += RELOAD_MS
    expect(await s.cache.reloaded()).toBe('b')
    expect(await s.cache.reloaded()).toBe('b')
    expect(s.loads()).toBe(2)
  })

  it('throttles failing loads too, and recovers after the interval', async () => {
    const s = setup([new Error('db down'), 'a'])
    await expect(s.cache.current()).rejects.toThrow('db down')
    expect(await s.cache.current()).toBeNull() // no hammering a failing database
    expect(s.loads()).toBe(1)
    s.clock.t += RELOAD_MS
    expect(await s.cache.current()).toBe('a')
  })

  it('caches a missing secret like any other value', async () => {
    const s = setup([null, 'a'])
    expect(await s.cache.current()).toBeNull()
    expect(await s.cache.reloaded()).toBeNull()
    expect(s.loads()).toBe(1)
  })
})
