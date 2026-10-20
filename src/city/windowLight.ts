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

// Share lit at hours 0, 3, 6, ... 24 (24 = 0).
//   Offices: mostly dark late, a few lights for cleaning and security; lit
//            through the working day, thinning through the evening
//   Residential: lit in the evening, peaking 21:00-23:00, few after 02:00
//   Storefronts: open into the evening, mostly dark after 22:00
export const LIT_SHARE: Record<WindowUse, number[]> = {
  [WindowUse.Office]: [0.06, 0.05, 0.14, 0.7, 0.72, 0.68, 0.42, 0.15, 0.06],
  [WindowUse.Residential]: [0.32, 0.1, 0.22, 0.16, 0.15, 0.18, 0.45, 0.58, 0.32],
  [WindowUse.Storefront]: [0.08, 0.06, 0.12, 0.85, 0.9, 0.9, 0.85, 0.42, 0.08],
}

export function litShare(use: WindowUse, hour: number): number {
  const table = LIT_SHARE[use]
  const h = ((hour % 24) + 24) % 24
  const i = Math.floor(h / 3)
  const t = h / 3 - i
  return table[i] + (table[i + 1] - table[i]) * t
}

const glslArray = (name: string, v: number[]) => `const float ${name}[9] = float[9](${v.map((x) => x.toFixed(3)).join(', ')});`

// GLSL for litShare(use, hour), generated from the same table. (Arrays
// can't be chosen with a ternary in GLSL ES, so each use reads its own.)
export const LIT_SHARE_GLSL = /* glsl */ `
${glslArray('LIT_OFFICE', LIT_SHARE[WindowUse.Office])}
${glslArray('LIT_RESIDENTIAL', LIT_SHARE[WindowUse.Residential])}
${glslArray('LIT_STOREFRONT', LIT_SHARE[WindowUse.Storefront])}
float litShare( int use, float hour ) {
  float h = mod( hour, 24.0 ) / 3.0;
  int i = int( floor( h ) );
  int j = min( i + 1, 8 );
  float a = use == 1 ? LIT_RESIDENTIAL[ i ] : use == 2 ? LIT_STOREFRONT[ i ] : LIT_OFFICE[ i ];
  float b = use == 1 ? LIT_RESIDENTIAL[ j ] : use == 2 ? LIT_STOREFRONT[ j ] : LIT_OFFICE[ j ];
  return mix( a, b, h - float( i ) );
}
`
