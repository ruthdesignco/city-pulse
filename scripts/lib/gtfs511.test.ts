import { describe, expect, it } from 'vitest'
import { downloadGtfs, redact } from './gtfs511.ts'

const KEY = 'synthetic-key+/=42'

describe('redact', () => {
  it('removes the key in raw and URL-encoded form, every occurrence', () => {
    const text = `https://x/?api_key=${encodeURIComponent(KEY)} and ${KEY} again ${KEY}`
    const out = redact(text, KEY)
    expect(out).not.toContain(KEY)
    expect(out).not.toContain(encodeURIComponent(KEY))
    expect(out.match(/\[redacted\]/g)).toHaveLength(3)
  })

  it('leaves text alone without a key', () => {
    expect(redact('nothing secret', undefined)).toBe('nothing secret')
    expect(redact('nothing secret', '')).toBe('nothing secret')
  })
})

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
