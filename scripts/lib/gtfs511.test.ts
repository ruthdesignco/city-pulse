import { describe, expect, it } from 'vitest'
import { downloadGtfs } from './gtfs511.ts'

// redact() itself is tested in supabase/functions/_shared/redact.test.ts.
const KEY = 'synthetic-key+/=42'

describe('downloadGtfs never leaks the key in errors', () => {
  const expectNoKey = async (fetchImpl: typeof fetch) => {
    const err = (await downloadGtfs(KEY, fetchImpl).catch((e: unknown) => e)) as Error
    expect(err).toBeInstanceOf(Error)
    expect(err.message).not.toContain(KEY)
    expect(err.message).not.toContain(encodeURIComponent(KEY))
    return err.message
  }

  it('when the request throws with the URL in the message and cause', async () => {
    const msg = await expectNoKey(async (url) => {
      throw new TypeError(`fetch failed for ${String(url)}`, { cause: new Error(`connect ${String(url)}`) })
    })
    expect(msg).toContain('[redacted]')
  })

  it('when the server echoes the key in an error body', async () => {
    const msg = await expectNoKey(async () => new Response(`bad key ${KEY}`, { status: 401 }))
    expect(msg).toContain('HTTP 401')
  })

  it('when the body is not a zip', async () => {
    const msg = await expectNoKey(async () => new Response(`{"error":"${KEY}"}`, { headers: { 'content-type': 'application/json' } }))
    expect(msg).toContain('expected a zip')
  })

  it('returns the bytes of a zip', async () => {
    const zip = new Uint8Array([0x50, 0x4b, 3, 4, 0])
    expect(await downloadGtfs(KEY, async () => new Response(zip))).toEqual(zip)
  })
})
