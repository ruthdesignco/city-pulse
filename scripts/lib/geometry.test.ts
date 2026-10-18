import { describe, expect, it } from 'vitest'
import {
  type Pt,
  centroid,
  distToRing,
  openRing,
  parseHeight,
  pointInRing,
  signedArea,
  simplifyLine,
  simplifyRing,
  stitchRings,
} from './geometry.ts'

const square: Pt[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]

describe('rings', () => {
  it('drops a duplicated closing point', () => {
    expect(openRing([...square, [0, 0]])).toEqual(square)
    expect(openRing(square)).toEqual(square)
  })

  it('computes signed area by winding', () => {
    expect(signedArea(square)).toBe(100)
    expect(signedArea([...square].reverse())).toBe(-100)
  })

  it('finds the area centroid', () => {
    expect(centroid(square)).toEqual([5, 5])
  })

  it('tests point in ring', () => {
    expect(pointInRing([5, 5], square)).toBe(true)
    expect(pointInRing([15, 5], square)).toBe(false)
  })

  it('measures distance to a ring edge', () => {
    expect(distToRing([15, 5], square)).toBe(5)
    expect(distToRing([13, 14], square)).toBe(5) // nearest point is the corner
  })
})

describe('simplify', () => {
  it('removes near-collinear points from a line but keeps the ends', () => {
    const line: Pt[] = [
      [0, 0],
      [5, 0.1],
      [10, 0],
    ]
    expect(simplifyLine(line, 0.5)).toEqual([
      [0, 0],
      [10, 0],
    ])
  })

  it('keeps a real corner', () => {
    const line: Pt[] = [
      [0, 0],
      [5, 5],
      [10, 0],
    ]
    expect(simplifyLine(line, 0.5)).toHaveLength(3)
  })

  it('simplifies a ring to its corners', () => {
    const noisy: Pt[] = [
      [0, 0],
      [5, 0.05],
      [10, 0],
      [10, 5],
      [10, 10],
      [5, 10.05],
      [0, 10],
      [0.05, 5],
    ]
    const s = simplifyRing(noisy, 0.5)
    expect(s).toHaveLength(4)
    expect(Math.abs(signedArea(s))).toBeCloseTo(100, 0)
  })
})

describe('stitchRings', () => {
  it('joins outer-member ways that share endpoints, in either direction', () => {
    const a: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ]
    const b: Pt[] = [
      [0, 0],
      [0, 10],
      [10, 10],
    ] // reversed relative to a
    const { rings, unclosed } = stitchRings([a, b])
    expect(unclosed).toBe(0)
    expect(rings).toHaveLength(1)
    expect(Math.abs(signedArea(rings[0]))).toBe(100)
  })

  it('reports ways it cannot close', () => {
    const { rings, unclosed } = stitchRings([
      [
        [0, 0],
        [1, 0],
      ],
    ])
    expect(rings).toHaveLength(0)
    expect(unclosed).toBe(1)
  })
})

describe('parseHeight', () => {
  it.each([
    ['12', 12],
    ['12.5', 12.5],
    ['12 m', 12],
    ['12m', 12],
    ['100 ft', 30.48],
    ["100'", 30.48],
    [`10'6"`, 3.2004],
  ])('parses %j', (raw, meters) => {
    expect(parseHeight(raw)).toBeCloseTo(meters, 3)
  })

  it.each([undefined, '', 'tall', '-5', '0', '12;15', '2000'])('rejects %j', (raw) => {
    expect(parseHeight(raw)).toBeUndefined()
  })
})
