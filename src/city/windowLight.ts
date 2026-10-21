// Which windows are lit at night (facade.ts): the share of a building's
// windows lit, by San Francisco hour and building use. Each window's own
// hash decides whether it's among that share, so the pattern is stable and
// thins out (or fills in) smoothly as the hour changes. Daytime values only
// matter through twilight; lit windows show from dusk to dawn
// (sceneUniforms.ts uWindowsOn).
//
// Illustrative, not data: no source says which windows are lit
// (Credits.tsx's "About this view" says so).

export const WindowUse = { Office: 0, Residential: 1, Storefront: 2 } as const
export type WindowUse = (typeof WindowUse)[keyof typeof WindowUse]

// Share lit at each hour 0, 1, 2, ... 24 (24 = 0). Hourly, so mornings
// and evenings turn where they should: on a 3-hour table, 07:00 sat a third
// of the way to the working day and towers were lit thicker before dawn
// than at 22:00.
//   Offices: mostly dark late, a few lights for cleaning and security;
//            still low at 07:00, filling 08:00-09:00, lit through the
//            working day, thinning through the evening
//   Residential: a modest bump as people get up (06:00-08:00), lit in the
//                evening, peaking 20:00-22:00, few after 02:00
//   Storefronts: open from 08:00-10:00 into the evening, mostly dark
//                after 22:00
// prettier-ignore
export const LIT_SHARE: Record<WindowUse, number[]> = {
  //                       0     1     2     3     4     5     6     7     8     9    10    11    12    13    14    15    16    17    18    19    20    21    22    23    24
  [WindowUse.Office]:      [0.06, 0.05, 0.05, 0.05, 0.05, 0.05, 0.06, 0.09, 0.3,  0.6,  0.7,  0.72, 0.7,  0.72, 0.72, 0.7,  0.66, 0.55, 0.4,  0.28, 0.2,  0.15, 0.11, 0.08, 0.06],
  [WindowUse.Residential]: [0.3,  0.2,  0.13, 0.09, 0.07, 0.09, 0.16, 0.24, 0.2,  0.14, 0.13, 0.13, 0.14, 0.14, 0.14, 0.15, 0.18, 0.26, 0.38, 0.48, 0.56, 0.58, 0.54, 0.44, 0.3],
  [WindowUse.Storefront]:  [0.06, 0.05, 0.05, 0.05, 0.05, 0.05, 0.06, 0.1,  0.3,  0.65, 0.85, 0.9,  0.9,  0.9,  0.9,  0.9,  0.9,  0.88, 0.85, 0.82, 0.72, 0.52, 0.3,  0.14, 0.06],
}

export function litShare(use: WindowUse, hour: number): number {
  const table = LIT_SHARE[use]
  const h = ((hour % 24) + 24) % 24
  const i = Math.floor(h)
  const t = h - i
  return table[i] + (table[i + 1] - table[i]) * t
}

const glslArray = (name: string, v: number[]) => `const float ${name}[${v.length}] = float[${v.length}](${v.map((x) => x.toFixed(3)).join(', ')});`

// GLSL for litShare(use, hour), generated from the same table. (Arrays
// can't be chosen with a ternary in GLSL ES, so each use reads its own.)
export const LIT_SHARE_GLSL = /* glsl */ `
${glslArray('LIT_OFFICE', LIT_SHARE[WindowUse.Office])}
${glslArray('LIT_RESIDENTIAL', LIT_SHARE[WindowUse.Residential])}
${glslArray('LIT_STOREFRONT', LIT_SHARE[WindowUse.Storefront])}
float litShare( int use, float hour ) {
  float h = mod( hour, 24.0 );
  int i = int( floor( h ) );
  int j = min( i + 1, 24 );
  float a = use == 1 ? LIT_RESIDENTIAL[ i ] : use == 2 ? LIT_STOREFRONT[ i ] : LIT_OFFICE[ i ];
  float b = use == 1 ? LIT_RESIDENTIAL[ j ] : use == 2 ? LIT_STOREFRONT[ j ] : LIT_OFFICE[ j ];
  return mix( a, b, h - float( i ) );
}
`
