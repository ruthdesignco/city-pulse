import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { COORD_QUANTUM, HEIGHT_QUANTUM, decodeCity } from '../../src/city/format.ts'
import { Glow, place } from '../../src/city/landmarks/build.ts'
import { LANDMARK_MODELS } from '../../src/city/landmarks/models.ts'
import { LANDMARKS, type LandmarkPlacement } from '../../src/city/landmarks/registry.ts'

const buf = readFileSync(join(import.meta.dirname, '../../src/data/city.bin'))
const city = decodeCity(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
const placements = city.header.landmarkModels ?? []
const at = (id: string) => placements.find((p) => p.id === id)!

function bounds(p: LandmarkPlacement) {
  const g = place(LANDMARK_MODELS[p.id](p), p)
  const pos = g.getAttribute('position').array as Float32Array
  let maxY = -Infinity
  let minY = Infinity
  for (let i = 1; i < pos.length; i += 3) {
    maxY = Math.max(maxY, pos[i])
    minY = Math.min(minY, pos[i])
  }
  return { g, maxY, minY, pos }
}

describe('landmark models', () => {
  it('has a builder and a baked placement for every landmark in the registry', () => {
    for (const l of LANDMARKS) {
      expect(LANDMARK_MODELS[l.id]).toBeTypeOf('function')
      expect(at(l.id)).toBeDefined()
    }
  })

  it('left their footprints out of the extrusion', () => {
    // No extruded building stands where a landmark is.
    for (const p of placements) {
      let c = 0
      for (let k = 0; k < city.buildings.counts.length; k++) {
        const n = city.buildings.counts[k]
        let sx = 0
        let sz = 0
        for (let i = 0; i < n; i++) {
          sx += city.buildings.coords[c + 2 * i] * COORD_QUANTUM
          sz += city.buildings.coords[c + 2 * i + 1] * COORD_QUANTUM
        }
        const d = Math.hypot(sx / n - p.x, sz / n - p.z)
        if (d < 4) expect(city.buildings.heights[k] * HEIGHT_QUANTUM).toBeLessThan(20)
        c += 2 * n
      }
    }
  })

  it('builds the Transamerica Pyramid to its 260 m spire, and Coit Tower to 64 m', () => {
    expect(bounds(at('transamerica')).maxY).toBeCloseTo(260, 3)
    expect(bounds(at('coit')).maxY).toBeCloseTo(64, 3)
    // On the ground; Coit Tower's plaza rim reaches a few meters down the hill.
    expect(bounds(at('transamerica')).minY).toBeCloseTo(0, 6)
    expect(bounds(at('coit')).minY).toBeGreaterThan(-5)
  })

  it('stands each model on its footprint, with finite geometry and outward faces', () => {
    for (const p of placements) {
      const { g, pos } = bounds(p)
      for (const v of pos) expect(Number.isFinite(v)).toBe(true)
      // The model's footprint at ground level stays within the OSM one's
      // rectangle (plus a meter), or Coit Tower's 21 m plaza.
      const reach = Math.max(Math.hypot(p.sizeX, p.sizeZ) / 2 + 1, p.id === 'coit' ? 21.5 : 0)
      for (let i = 0; i < pos.length; i += 3) if (pos[i + 1] < 1 && pos[i + 1] > -0.5) expect(Math.hypot(pos[i] - p.x, pos[i + 2] - p.z)).toBeLessThan(reach)
      // Side walls face away from the model's axis (below 200 m: above it
      // the pyramid's wings have inner faces toward the spire).
      const nor = g.getAttribute('normal').array as Float32Array
      for (let i = 0; i < pos.length; i += 9) {
        const cx = (pos[i] + pos[i + 3] + pos[i + 6]) / 3 - p.x
        const cz = (pos[i + 2] + pos[i + 5] + pos[i + 8]) / 3 - p.z
        const cy = (pos[i + 1] + pos[i + 4] + pos[i + 7]) / 3
        if (cy < 200 && Math.abs(nor[i + 1]) < 0.5 && Math.hypot(cx, cz) > 2) expect(nor[i] * cx + nor[i + 2] * cz).toBeGreaterThan(0)
      }
    }
  })

  it('gives the pyramid windows and Coit Tower its floodlight', () => {
    const glows = (id: string) => new Set(place(LANDMARK_MODELS[id](at(id)), at(id)).getAttribute('glow').array as Float32Array)
    expect(glows('transamerica').has(Glow.Windows)).toBe(true)
    expect(glows('coit').has(Glow.Flood)).toBe(true)
    expect(glows('coit').has(Glow.Opening)).toBe(true)
  })

  it('bakes Pioneer Park around Coit Tower', () => {
    expect(at('coit').grounds!.length).toBeGreaterThan(6)
  })
})
