// Minimal RFC 4180 CSV reader for GTFS: quoted fields, "" escapes, LF or
// CRLF line ends, optional UTF-8 BOM. Rows become records keyed by header.

export function parseCsv(text: string): Record<string, string>[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const n = text.length
  if (n === 0) return []

  const rows: string[][] = []
  let row: string[] = []
  let i = 0
  for (;;) {
    if (text[i] === '"') {
      let value = ''
      i++
      for (;;) {
        const q = text.indexOf('"', i)
        if (q === -1) throw new Error(`csv: unterminated quote in row ${rows.length + 1}`)
        value += text.slice(i, q)
        if (text[q + 1] === '"') {
          value += '"'
          i = q + 2
        } else {
          i = q + 1
          break
        }
      }
      row.push(value)
    } else {
      let j = i
      while (j < n && text[j] !== ',' && text[j] !== '\n' && text[j] !== '\r') j++
      row.push(text.slice(i, j))
      i = j
    }

    if (i >= n) {
      rows.push(row)
      break
    }
    const c = text[i]
    if (c === ',') {
      i++
      continue
    }
    if (c !== '\n' && c !== '\r') throw new Error(`csv: unexpected ${JSON.stringify(c)} after quoted field in row ${rows.length + 1}`)
    if (c === '\r' && text[i + 1] === '\n') i++
    i++
    rows.push(row)
    row = []
    if (i >= n) break
  }

  const [header, ...body] = rows
  const keys = header.map((h) => h.trim())
  const out: Record<string, string>[] = []
  for (const r of body) {
    if (r.length === 1 && r[0] === '') continue // blank line
    const rec: Record<string, string> = {}
    keys.forEach((k, idx) => (rec[k] = r[idx] ?? ''))
    out.push(rec)
  }
  return out
}
