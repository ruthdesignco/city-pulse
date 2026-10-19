import { describe, expect, it } from 'vitest'
import type { RoutesFile } from './routes-format.ts'
import { buildShapeIndex, makeLine, pointAt, projectOnLine } from './shapes.ts'

// An L: 100 m east, then 50 m south (+z).
const L = makeLine('L#0', 'R', 0, [0, 0, 100, 0, 100, 50])

describe('makeLine', () => {
  it('measures cumulative length', () => {
    expect([...L.cum]).toEqual([0, 100, 150])
    expect(L.length).toBe(150)
  })
})

describe('projectOnLine', () => {
  it('finds distance along and off the line', () => {
    expect(projectOnLine(L, 40, -3)).toEqual({ s: 40, d: 3, x: 40, z: 0 })
    expect(projectOnLine(L, 104, 20)).toEqual({ s: 120, d: 4, x: 100, z: 20 })
  })

  it('clamps to the ends', () => {
    expect(projectOnLine(L, -10, 0)).toMatchObject({ s: 0, d: 10 })
    expect(projectOnLine(L, 100, 80)).toMatchObject({ s: 150, d: 30 })
  })

  it('restricts the search to a distance window', () => {
    // A point near the corner, but only s >= 110 is allowed.
    const p = projectOnLine(L, 95, 5, 110)!
    expect(p.s).toBeCloseTo(110, 9)
    expect(projectOnLine(L, 50, 0, 0, 30)).toMatchObject({ s: 30, d: 20 })
    expect(projectOnLine(L, 50, 0, 200, 300)).toBeNull()
  })
})

describe('pointAt', () => {
  it('interpolates position and heading', () => {
    expect(pointAt(L, 25)).toEqual({ x: 25, z: 0, hx: 1, hz: 0 })
    expect(pointAt(L, 125)).toEqual({ x: 100, z: 25, hx: 0, hz: 1 })
  })

  it('clamps outside the line', () => {
    expect(pointAt(L, -5)).toMatchObject({ x: 0, z: 0 })
    expect(pointAt(L, 999)).toMatchObject({ x: 100, z: 50 })
  })
})

describe('buildShapeIndex', () => {
  it('dequantizes pieces into lines grouped by route', () => {
    const file: RoutesFile = {
      version: 1,
      source: 'test',
      feed: { version: null, startDate: null, endDate: null },
      coordQuantum: 0.1,
      routes: [
        { id: '14', shortName: '14', longName: '', type: 3, color: null, shapes: [{ id: 's1', direction: 1, pieces: [[0, 0, 1000, 0], [0, 50, 0, 60]] }] },
        { id: 'X', shortName: 'X', longName: '', type: 3, color: null, shapes: [{ id: 's2', direction: null, pieces: [[5, 5, 5, 5]] }] },
      ],
    }
    const index = buildShapeIndex(file)
    expect([...index.keys()]).toEqual(['14']) // zero-length lines dropped
    const [a, b] = index.get('14')!
    expect(a).toMatchObject({ key: 's1#0', routeId: '14', direction: 1, length: 100 })
    expect(b.key).toBe('s1#1')
    expect(b.length).toBeCloseTo(1, 9)
  })
})
