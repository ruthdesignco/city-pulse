import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RoutesFile } from './routes-format.ts'

const file: RoutesFile = {
  version: 1,
  source: '511',
  feed: { version: null, startDate: null, endDate: null },
  coordQuantum: 0.1,
  routes: [],
}

const ok = () => ({ ok: true, json: () => Promise.resolve(file) })
const fail = (status: number) => ({ ok: false, status })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules() // loadRoutes caches its promise at module scope
})

describe('loadRoutes', () => {
  it('fetches once and shares the promise across calls', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok())
    vi.stubGlobal('fetch', fetchMock)
    const { loadRoutes } = await import('./useRoutes.ts')

    const [a, b] = await Promise.all([loadRoutes(), loadRoutes()])
    expect(a).toBe(b)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('clears the cache on failure, so a retry actually refetches instead of suspending on the dead promise', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(fail(500)).mockResolvedValueOnce(ok())
    vi.stubGlobal('fetch', fetchMock)
    const { loadRoutes } = await import('./useRoutes.ts')

    await expect(loadRoutes()).rejects.toThrow('routes.json: HTTP 500')
    await expect(loadRoutes()).resolves.toMatchObject({ file })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
