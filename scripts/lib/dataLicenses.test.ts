import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RoutesFile } from '../../src/transit/routes-format.ts'
import { readIndex } from './tileFiles.ts'

// Every shipped data file has a line in the README's "Data and licenses",
// and the files that are OSM-derived say so in their own headers (Board of
// Vibes 2026-10-22: the trees and routes had said PDDL and 511 only).
const ROOT = join(import.meta.dirname, '../..')
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
const licenses = readme.slice(readme.indexOf('## Data and licenses'), readme.indexOf('## Third-party code'))

describe('data licenses', () => {
  it("lists every shipped data file in the README's Data and licenses", () => {
    const tileLayers = new Set(readdirSync(join(ROOT, 'public/tiles')).map((f) => f.replace(/-.*$/, '')))
    for (const layer of tileLayers) expect(licenses, `public/tiles/${layer}-*.bin`).toContain(`public/tiles/${layer}-*.bin`)
    for (const f of readdirSync(join(ROOT, 'src/data'))) expect(licenses, `src/data/${f}`).toContain(`src/data/${f}`)
  })

  it('states the tree tiles as ODbL, and where their OSM trees came from', () => {
    const trees = readIndex().sources.trees ?? ''
    expect(trees).toMatch(/^ODbL 1\.0 as a whole/)
    expect(trees).toMatch(/DataSF \(PDDL 1\.0\)/)
    expect(trees).toMatch(/OpenStreetMap contributors \(ODbL\), extract of \d{4}-\d\d-\d\d/)
  })

  it('records the OSM data routes.json was snapped to, and its 511 terms', () => {
    const head = JSON.parse(readFileSync(join(ROOT, 'src/data/routes.json'), 'utf8')) as RoutesFile
    expect(head.source).toMatch(/511\.org.*511 Data Disseminator Agreement/)
    expect(head.osm.license).toMatch(/ODbL 1\.0/)
    expect(head.osm.streets).toMatch(/OpenStreetMap contributors \(ODbL\), extract of \d{4}-\d\d-\d\d/)
    expect(head.osm.tunnels).toMatch(/OpenStreetMap contributors \(ODbL\), Overpass \d{4}-\d\d-\d\d/)
  })
})
