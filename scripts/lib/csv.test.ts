import { describe, expect, it } from 'vitest'
import { parseCsv } from './csv.ts'

describe('parseCsv', () => {
  it('reads records keyed by header', () => {
    expect(parseCsv('route_id,route_type\n14,3\nF,0\n')).toEqual([
      { route_id: '14', route_type: '3' },
      { route_id: 'F', route_type: '0' },
    ])
  })

  it('handles quoted fields with commas, escaped quotes and newlines', () => {
    expect(parseCsv('id,name\n1,"Mission, Outbound"\n2,"say ""hi"""\n3,"two\nlines"')).toEqual([
      { id: '1', name: 'Mission, Outbound' },
      { id: '2', name: 'say "hi"' },
      { id: '3', name: 'two\nlines' },
    ])
  })

  it('handles CRLF, a BOM, padded headers and a missing final newline', () => {
    expect(parseCsv('﻿a, b\r\n1,2\r\n3,4')).toEqual([
      { a: '1', b: '2' },
      { a: '3', b: '4' },
    ])
  })

  it('keeps empty and trailing empty fields; fills short rows', () => {
    expect(parseCsv('a,b,c\n1,,\n2\n')).toEqual([
      { a: '1', b: '', c: '' },
      { a: '2', b: '', c: '' },
    ])
  })

  it('skips blank lines', () => {
    expect(parseCsv('a\n1\n\n2\n')).toEqual([{ a: '1' }, { a: '2' }])
  })

  it('returns nothing for empty input or a header only', () => {
    expect(parseCsv('')).toEqual([])
    expect(parseCsv('a,b\n')).toEqual([])
  })

  it('rejects malformed quoting', () => {
    expect(() => parseCsv('a\n"open')).toThrow(/unterminated/)
    expect(() => parseCsv('a,b\n"x"y,1')).toThrow(/after quoted field/)
  })
})
