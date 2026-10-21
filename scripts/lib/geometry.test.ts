import { describe, expect, it } from 'vitest'
import {
  type Pt,
  centroid,
  clipPolylineToRect,
  minAreaRect,
  distToRing,
  inBakeArea,
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

describe('inBakeArea', () => {
  it('accepts points inside a ring or within the margin of one', () => {
    expect(inBakeArea([5, 5], [square], 3)).toBe(true)
    expect(inBakeArea([12, 5], [square], 3)).toBe(true)
    expect(inBakeArea([14, 5], [square], 3)).toBe(false)
  })
})

describe('clipPolylineToRect', () => {
  const r = { minX: 0, minZ: 0, maxX: 10, maxZ: 10 }

  it('keeps a line fully inside unchanged', () => {
    const line: Pt[] = [
      [1, 1],
      [5, 5],
      [9, 2],
    ]
    expect(clipPolylineToRect(line, r)).toEqual([line])
  })

  it('drops a line fully outside', () => {
    expect(
      clipPolylineToRect(
        [
          [-5, -5],
          [-1, 20],
        ],
        r,
      ),
    ).toEqual([])
  })

  it('cuts at the exact crossing when entering and leaving', () => {
    expect(
      clipPolylineToRect(
        [
          [-10, 5],
          [5, 5],
          [5, 20],
        ],
        r,
      ),
    ).toEqual([
      [
        [0, 5],
        [5, 5],
        [5, 10],
      ],
    ])
  })

  it('keeps a long segment that passes through with both ends outside', () => {
    expect(
      clipPolylineToRect(
        [
          [-100, 5],
          [100, 5],
        ],
        r,
      ),
    ).toEqual([
      [
        [0, 5],
        [10, 5],
      ],
    ])
  })

  it('splits into separate runs when the line leaves and re-enters', () => {
    const pieces = clipPolylineToRect(
      [
        [2, 2],
        [2, 20],
        [8, 20],
        [8, 2],
      ],
      r,
    )
    expect(pieces).toEqual([
      [
        [2, 2],
        [2, 10],
      ],
      [
        [8, 10],
        [8, 2],
      ],
    ])
  })

  it('drops a run that only touches a corner', () => {
    expect(
      clipPolylineToRect(
        [
          [-5, 5],
          [5, -5],
        ],
        { minX: 0, minZ: 0, maxX: 10, maxZ: 10 },
      ),
    ).toEqual([])
  })
})

describe('minAreaRect', () => {
  it('finds a turned rectangle, with local x the side nearest the x axis', () => {
    const a = (10 * Math.PI) / 180
    const c = Math.cos(a)
    const s = Math.sin(a)
    // 40 (along x) by 20, turned 10 deg, centered at (100, 50).
    const corners: [number, number][] = [
      [-20, -10],
      [20, -10],
      [20, 10],
      [-20, 10],
    ]
    const ring = corners.map(([x, z]) => [100 + x * c - z * s, 50 + x * s + z * c] as [number, number])
    const r = minAreaRect(ring)
    expect(r.center[0]).toBeCloseTo(100, 6)
    expect(r.center[1]).toBeCloseTo(50, 6)
    expect(r.angle).toBeCloseTo(a, 6)
    expect(r.sizeX).toBeCloseTo(40, 6)
    expect(r.sizeZ).toBeCloseTo(20, 6)
  })
})
