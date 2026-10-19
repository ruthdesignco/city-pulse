import { palette } from '../city/palette.ts'

// Dusk: a low warm sun from the west-northwest (where it sets over SF) rakes
// across the grid, with a cool sky fill so shaded walls stay readable.
// Linear fog in the sky color fades the context ring into the background.
export function Atmosphere() {
  return (
    <>
      <color attach="background" args={[palette.sky]} />
      <fog attach="fog" args={[palette.sky, 4500, 11000]} />
      <hemisphereLight args={[palette.skyFill, palette.groundFill, 1.6]} />
      <directionalLight color={palette.sun} position={[-3000, 1400, -1200]} intensity={2.6} />
    </>
  )
}
