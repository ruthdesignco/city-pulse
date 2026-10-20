// Low poly vehicle models, built from boxes in code (no model files, nothing
// to license), flat shaded and sun lit like the buildings. Long axis +x,
// front at +x, wheels on y = 0, centered on x and z, in meters at true size:
//
//   bus40   40 ft bus, 12.2 m
//   bus60   60 ft articulated bus, 10.4 + 7.1 m sections around a bellows
//   rail    light rail car, two 11.1 m halves, pantograph
//   cable   cable car, 8.3 m: closed wood cabin, open ends, clerestory roof
//
// Every vertex carries its real body color; the material is lit by the sun
// like the buildings, with no emission. Staleness (per instance, aStale 0..1)
// desaturates and slightly lightens the whole vehicle -- a faded look, never
// a tint, and never darker than the asphalt (palette.test.ts).

import { BoxGeometry, BufferAttribute, type BufferGeometry, Color, MeshStandardMaterial } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { palette } from '../city/palette.ts'
import { sceneUniforms } from '../scene/sceneUniforms.ts'
import type { VehicleKind } from './fleet.ts'

export const MODEL_LENGTH_M: Record<VehicleKind, number> = { bus40: 12.2, bus60: 18.3, rail: 23, cable: 8.3 }
export const MODEL_WIDTH_M: Record<VehicleKind, number> = { bus40: 2.55, bus60: 2.55, rail: 2.65, cable: 2.45 }

// A fully stale vehicle: this much of the way to its own luminance (gray),
// then this much toward white -- faded, not darker.
export const STALE_DESATURATE = 0.8
export const STALE_LIGHTEN = 0.15

// Night lighting (vehicleMaterial): the cabin seen through the glass, and
// the headlamps; dimmer on a stale vehicle. Scene units at night exposure.
const GLOW_CABIN = 1
const GLOW_LAMP = 2
export const CABIN_LIGHT = 0.22
export const LAMP_LIGHT = 1.1

interface Part {
  at: [number, number, number] // center
  size: [number, number, number]
  color: string
  rotZ?: number
}

function build(parts: Part[]): BufferGeometry {
  const pieces = parts.map((p) => {
    const g = new BoxGeometry(...p.size)
    g.deleteAttribute('uv')
    if (p.rotZ) g.rotateZ(p.rotZ)
    g.translate(...p.at)
    const n = g.getAttribute('position').count
    const c = new Color(p.color)
    const color = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) color.set([c.r, c.g, c.b], i * 3)
    g.setAttribute('color', new BufferAttribute(color, 3))
    // At night (vehicleMaterial): window glass shows a lit cabin, lamps glow.
    const glow = p.color === palette.liveryGlass ? GLOW_CABIN : p.color === palette.liveryLamp ? GLOW_LAMP : 0
    g.setAttribute('aGlow', new BufferAttribute(new Float32Array(n).fill(glow), 1))
    return g
  })
  const merged = mergeGeometries(pieces)
  for (const g of pieces) g.dispose()
  if (!merged) throw new Error('vehicleModels: could not merge parts')
  return merged
}

const box = (at: Part['at'], size: Part['size'], color: string, extra: Partial<Part> = {}): Part => ({ at, size, color, ...extra })

// A bus body section from x0 (rear) to x1 (front). `nose`/`tail`: whether this
// section carries the windshield / rear window.
function busSection(x0: number, x1: number, W: number, nose: boolean, tail: boolean): Part[] {
  const len = x1 - x0
  const cx = (x0 + x1) / 2
  const parts = [
    box([cx, 0.45, 0], [len - 0.1, 0.3, W - 0.12], palette.liverySkirt),
    box([cx, 1.775, 0], [len, 2.35, W], palette.liveryBody),
    box([cx, 1.325, 0], [len + 0.02, 0.25, W + 0.02], palette.liveryBusStripe),
    box([cx + (nose ? -0.4 : 0), 2.075, 0], [len - (nose ? 1.6 : 0.6), 0.95, W + 0.04], palette.liveryGlass),
    box([cx - 0.3, 3.1, 0], [Math.min(len - 2, 6), 0.3, W - 0.7], palette.liveryRoof),
  ]
  if (nose)
    parts.push(
      box([x1, 1.95, 0], [0.06, 1.5, W - 0.3], palette.liveryGlass),
      box([x1, 0.9, W / 2 - 0.35], [0.06, 0.2, 0.4], palette.liveryLamp),
      box([x1, 0.9, -(W / 2 - 0.35)], [0.06, 0.2, 0.4], palette.liveryLamp),
    )
  if (tail) parts.push(box([x0, 2.2, 0], [0.06, 0.6, W - 0.6], palette.liveryGlass))
  return parts
}

const wheels = (x: number, W: number): Part => box([x, 0.45, 0], [1, 0.9, W + 0.04], palette.liveryWheel)
const bellows = (x: number, W: number): Part => box([x, 1.7, 0], [0.9, 2.4, W - 0.3], palette.liveryJoint)

function bus40(): BufferGeometry {
  const L = MODEL_LENGTH_M.bus40
  const W = MODEL_WIDTH_M.bus40
  return build([...busSection(-L / 2, L / 2, W, true, true), wheels(L / 2 - 2.3, W), wheels(-L / 2 + 3.2, W)])
}

function bus60(): BufferGeometry {
  const L = MODEL_LENGTH_M.bus60
  const W = MODEL_WIDTH_M.bus60
  const joint = 0.8
  const frontRear = L / 2 - 10.4
  const rearFront = frontRear - joint
  return build([
    ...busSection(frontRear, L / 2, W, true, false),
    bellows(frontRear - joint / 2, W),
    ...busSection(-L / 2, rearFront, W, false, true),
    wheels(L / 2 - 2.3, W),
    wheels(frontRear + 1.6, W),
    wheels(-L / 2 + 2, W),
  ])
}

function rail(): BufferGeometry {
  const L = MODEL_LENGTH_M.rail
  const W = MODEL_WIDTH_M.rail
  const half = (L - 0.8) / 2
  const parts: Part[] = []
  for (const sign of [1, -1]) {
    const cx = sign * (0.4 + half / 2)
    const end = sign * (L / 2)
    parts.push(
      box([cx, 2.025, 0], [half, 2.75, W], palette.liveryRail),
      box([cx, 1.125, 0], [half + 0.02, 0.25, W + 0.02], palette.liveryRailStripe),
      box([cx - sign * 0.3, 2.0, 0], [half - 1.4, 1.2, W + 0.04], palette.liveryGlass),
      // Cab at each end: it runs both ways.
      box([end, 2.15, 0], [0.06, 1.3, W - 0.3], palette.liveryGlass),
      box([end, 1.0, W / 2 - 0.35], [0.06, 0.2, 0.4], palette.liveryLamp),
      box([end, 1.0, -(W / 2 - 0.35)], [0.06, 0.2, 0.4], palette.liveryLamp),
      box([sign * (L / 2 - 2.4), 0.35, 0], [2.2, 0.6, W - 0.4], palette.liveryWheel),
      box([cx, 3.5, 0], [half - 3, 0.2, W - 0.9], palette.liveryRoof),
    )
  }
  parts.push(
    bellows(0, W),
    box([0, 0.35, 0], [2.2, 0.6, W - 0.4], palette.liveryWheel),
    // Pantograph: base, arm, collector bar.
    box([3.5, 3.68, 0], [1.4, 0.16, 1.1], palette.liveryJoint),
    box([3.5, 4.1, 0], [1.3, 0.07, 0.07], palette.liveryJoint, { rotZ: 0.75 }),
    box([3.95, 4.5, 0], [0.18, 0.07, 1.7], palette.liveryJoint),
  )
  return build(parts)
}

function cable(): BufferGeometry {
  const L = MODEL_LENGTH_M.cable
  const W = MODEL_WIDTH_M.cable
  const cabin = 4
  const parts: Part[] = [
    box([0, 0.35, 0], [L - 1.6, 0.3, W - 0.6], palette.liverySkirt),
    box([L / 2 - 1.8, 0.25, 0], [1.4, 0.5, W - 0.5], palette.liveryWheel),
    box([-(L / 2 - 1.8), 0.25, 0], [1.4, 0.5, W - 0.5], palette.liveryWheel),
    box([0, 0.65, 0], [L, 0.3, W], palette.cableWoodDark),
    box([0, 1.85, 0], [cabin, 2.1, W], palette.cableWood),
    box([0, 2.1, 0], [cabin - 0.5, 0.8, W + 0.04], palette.liveryGlass),
    box([0, 3.1, 0], [L + 0.2, 0.18, W + 0.25], palette.cableRoof),
    // Clerestory, a strip of small windows along it.
    box([0, 3.33, 0], [L - 1.6, 0.28, 1.1], palette.cableRoof),
    box([0, 3.33, 0], [L - 2, 0.12, 1.14], palette.liveryGlass),
  ]
  for (const sign of [1, -1]) {
    const endX = sign * (L / 2 - 0.05)
    const openX = sign * (cabin / 2 + (L / 2 - cabin / 2) / 2)
    const openLen = L / 2 - cabin / 2
    parts.push(
      // Low wood side panels and an end dash around the open section.
      box([openX, 1.1, W / 2 - 0.04], [openLen, 0.6, 0.08], palette.cableWood),
      box([openX, 1.1, -(W / 2 - 0.04)], [openLen, 0.6, 0.08], palette.cableWood),
      box([endX, 1.2, 0], [0.1, 0.8, W], palette.cableWood),
      box([endX + sign * 0.04, 1.1, 0], [0.06, 0.28, 0.32], palette.liveryLamp),
      // Benches and roof posts.
      box([openX, 1.3, 0], [openLen - 0.3, 0.12, 0.7], palette.cableWoodDark),
    )
    for (const px of [sign * (cabin / 2 + 0.6), sign * (L / 2 - 0.2)])
      for (const pz of [W / 2 - 0.08, -(W / 2 - 0.08)]) parts.push(box([px, 2.25, pz], [0.12, 1.7, 0.12], palette.cableWoodDark))
  }
  return build(parts)
}

export function buildVehicleGeometry(kind: VehicleKind): BufferGeometry {
  switch (kind) {
    case 'bus40':
      return bus40()
    case 'bus60':
      return bus60()
    case 'rail':
      return rail()
    case 'cable':
      return cable()
  }
}

// One material for all four models. Per-instance attribute, set by
// Vehicles.tsx: aStale (float 0..1), how stale the vehicle's data is.
export function vehicleMaterial(): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, flatShading: true })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aStale;\nattribute float aGlow;\nvarying float vStale;\nvarying float vGlow;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvStale = aStale;\nvGlow = aGlow;')
    shader.uniforms.uWindowsOn = sceneUniforms.uWindowsOn
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWindowsOn;\nvarying float vStale;\nvarying float vGlow;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
float cabin = 1.0 - step( 0.5, abs( vGlow - ${GLOW_CABIN.toFixed(1)} ) );
float lamp = 1.0 - step( 0.5, abs( vGlow - ${GLOW_LAMP.toFixed(1)} ) );
totalEmissiveRadiance += uWindowsOn * ( 1.0 - 0.7 * vStale ) * ( cabin * ${CABIN_LIGHT.toFixed(3)} * vec3( 1.0, 0.92, 0.78 ) + lamp * ${LAMP_LIGHT.toFixed(3)} * vec3( 1.0, 0.95, 0.85 ) );`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float gray = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(gray), ${STALE_DESATURATE.toFixed(3)} * vStale);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), ${STALE_LIGHTEN.toFixed(3)} * vStale);`,
      )
  }
  material.customProgramCacheKey = () => 'city-vehicles-v3'
  return material
}

// What a vehicle color becomes when fully stale (linear RGB), mirroring the
// shader above; for palette.test.ts.
export function staleColor(hex: string): Color {
  const c = new Color(hex)
  const gray = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  const d = STALE_DESATURATE
  const l = STALE_LIGHTEN
  const f = (v: number) => (v + (gray - v) * d) * (1 - l) + l
  return new Color(f(c.r), f(c.g), f(c.b))
}
