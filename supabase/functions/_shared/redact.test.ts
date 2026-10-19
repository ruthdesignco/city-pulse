import { describe, expect, it } from 'vitest'
import { redact } from './redact.ts'

const KEY = 'synthetic-key+/=42'

describe('redact', () => {
  it('removes the key in raw and URL-encoded form, every occurrence', () => {
    const text = `https://x/?api_key=${encodeURIComponent(KEY)} and ${KEY} again ${KEY}`
    const out = redact(text, KEY)
    expect(out).not.toContain(KEY)
    expect(out).not.toContain(encodeURIComponent(KEY))
    expect(out.match(/\[redacted\]/g)).toHaveLength(3)
  })

  it('removes any api_key query value, even one that is not the configured key', () => {
    expect(redact('GET https://api.511.org/x?agency=SF&api_key=other-key-123&format=pb', KEY)).toBe(
      'GET https://api.511.org/x?agency=SF&api_key=[redacted]&format=pb',
    )
    expect(redact('url "https://a/?API_KEY=abc"', undefined)).toBe('url "https://a/?API_KEY=[redacted]"')
  })

  it('leaves text alone when there is nothing to scrub', () => {
    expect(redact('nothing secret', undefined)).toBe('nothing secret')
    expect(redact('nothing secret', '')).toBe('nothing secret')
  })
})
