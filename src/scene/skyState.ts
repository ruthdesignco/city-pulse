// The time of day: everything the light, the sky, the haze and the lit
// windows need, from one instant (skyClock.ts supplies it: the real San
// Francisco time, or ?time=). Pure, so it's tested directly.
//
// Exposure works like a camera's: by day the solve keeps a sunlit
// horizontal surface at its palette color (scene exposure 1, as lighting.ts
// always did, so `npm run calibrate` still means the same thing at noon or
// at golden hour). Through twilight the exposure eases down to a fixed
// night level, NIGHT_EXPOSURE, at which the moon and the sky fill light the
// city: readable, clearly night. Every value moves continuously with the
// sun's height, so nothing jumps at sunrise or sunset.
//
// Weather (weather.ts) comes in as cloud cover and visibility. Cloud moves
// light from the sun to the soft sky fill and dims the whole a little, so
// shadows fade and soften without the scene going muddy; the sky turns to a
// flat overcast gradient (warm gray at night, lit by the city), and the
// moon goes behind it. Low visibility becomes the height fog's density
// (heightFog.ts), its color following the light. Clear weather changes
// nothing: every weather term is exactly a no-op at zero.

import * as SunCalc from 'suncalc'
import { Color, Vector3 } from 'three'
import { palette } from '../city/palette.ts'
import { ORIGIN } from '../geo/projection.ts'
import { sfHour, sfIsWeekend } from './sfTime.ts'
import { CLEAR_WEATHER, FOG_RAMP_M, FOG_SOFT_M, FOG_TOP_M, type Weather, fogDensity } from './weather.ts'
import { SKY_EXPOSURE, type SkyLook, SUN_DIRECTION, hazeColor, rawHorizonLuminance } from './skyModel.ts'
import { bearingToScene } from './sun.ts'

export const NIGHT_EXPOSURE = 0.09
// Exposure is 1 with the sun this high or higher, NIGHT_EXPOSURE from this
// low; it falls fastest just after sunset (blue hour is already dim).
const EXPOSURE_FULL_DEG = 6
const EXPOSURE_NIGHT_DEG = -7
// The sun's share of a sunlit surface's light, low sun to high sun.
const SUN_SHARE_LOW = 0.55
const SUN_SHARE_HIGH = 0.72
// Below this the direct solve would divide by a vanishing sin(elevation);
// the sun instead fades out over the last degrees to the horizon.
const SUN_SOLVE_MIN_DEG = 5
// The sun's most: about the old fixed golden-hour sun's (~6.7). A low sun
// solved to light flat ground fully would make the walls facing it several
// times their color; capped, the fill makes up the ground instead.
const SUN_INTENSITY_MAX = 7.5
// The moon's share of the night light when it's high and full.
const MOON_SHARE = 0.45
// Under full overcast: the whole light this much dimmer, and the sun (behind
// the clouds) left with this share of its clear-sky strength; the fill makes
// up the rest. By day the fill turns from sky blue to the cool white of
// light through cloud, and the ground bounce from warm to neutral gray (with
// the sun's warmth mostly gone, both left the scene sepia); at night the
// fill keeps its cool gray (neutralized, it went brown under the
// streetlights' warm white).
const OVERCAST_DIM = 0.2
const OVERCAST_SUN_CUT = 0.95
// Through night fog, this much of a lit window's brightness over the fog's
// shows through (heightFog.ts uFogGlow).
const FOG_WINDOW_GLOW = 0.6

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const DEG = Math.PI / 180
const lum = (c: Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
const dirFrom = (azimuthDeg: number, altitudeDeg: number) => new Vector3(...bearingToScene(azimuthDeg, altitudeDeg, 1))

export interface SkyState {
  date: Date
  hour: number // San Francisco local, fractional
  weekend: boolean // Saturday or Sunday in San Francisco: which lit-window schedule
  sunElevation: number // degrees
  sunDirection: Vector3 // unit, scene space, toward the sun
  moonElevation: number
  moonDirection: Vector3
  moonFraction: number // illuminated, 0-1
  exposure: number // 1 by day, NIGHT_EXPOSURE at night
  // The directional light: the sun by day, the moon at night (when it's up).
  light: { direction: Vector3; color: Color; intensity: number; isMoon: boolean }
  // The hemisphere fill: sky color, ground bounce color, intensity.
  fill: { sky: Color; ground: Color; intensity: number }
  sky: SkyLook
  haze: Color // the horizon averaged around: what the context ring fades toward
  windowsOn: number // 0 by day, 1 from dusk: how much lit windows show
  cloud: number // the weather's cloud cover, 0-1
  // The height fog (heightFog.ts): extinction per meter, color, layer top
  // and thinning band, the ramp in from the camera, and how much lit windows
  // glow through. Density 0 is no fog.
  fog: { density: number; color: Color; top: number; soft: number; ramp: number; glow: number }
}

// The sun's color by height (linear): sunLow at the horizon, palette.sun's
// gold at 16 deg, sunHigh from 40 deg.
export function sunColorAt(elevation: number): Color {
  const low = new Color(palette.sunLow)
  const mid = new Color(palette.sun)
  const high = new Color(palette.sunHigh)
  if (elevation <= 16) return low.lerp(mid, smooth(0, 16, elevation))
  return mid.lerp(high, smooth(16, 40, elevation))
}

export function exposureAt(elevation: number): number {
  return NIGHT_EXPOSURE + (1 - NIGHT_EXPOSURE) * smooth(EXPOSURE_NIGHT_DEG, EXPOSURE_FULL_DEG, elevation) ** 1.5
}

// The Preetham horizon brightness at the old fixed golden-hour sun (sun.ts),
// whose exposure SKY_EXPOSURE was tuned for: the reference the sky is held to.
const REFERENCE_HORIZON = rawHorizonLuminance(SUN_DIRECTION) * SKY_EXPOSURE

export function computeSkyState(date: Date, weather: Weather = CLEAR_WEATHER): SkyState {
  const sun = SunCalc.getPosition(date, ORIGIN.lat, ORIGIN.lng)
  const moon = SunCalc.getMoonPosition(date, ORIGIN.lat, ORIGIN.lng)
  const moonFraction = SunCalc.getMoonIllumination(date).fraction
  const elev = sun.altitude
  const sunDirection = dirFrom(sun.azimuth, sun.altitude)
  const moonDirection = dirFrom(moon.azimuth, moon.altitude)
  const exposure = exposureAt(elev)
  const cloud = Math.min(1, Math.max(0, weather.cloud))
  // The light on the ground: the camera's exposure, a little dimmer under cloud.
  const level = exposure * (1 - OVERCAST_DIM * cloud)
  const target = Math.PI * level // irradiance on lit horizontal ground
  const dayness = smooth(-2, 8, elev)
  const nightness = 1 - smooth(-8, -1, elev)

  // The sun, solved as lighting.ts does at any height, fading out at the horizon.
  const sunColor = sunColorAt(elev)
  const share = SUN_SHARE_LOW + (SUN_SHARE_HIGH - SUN_SHARE_LOW) * smooth(16, 50, elev)
  const sunFade = smooth(-1, SUN_SOLVE_MIN_DEG, elev)
  const sunIntensity =
    Math.min(SUN_INTENSITY_MAX * exposure, (share * target) / (Math.sin(Math.max(elev, SUN_SOLVE_MIN_DEG) * DEG) * lum(sunColor))) *
    sunFade *
    (1 - OVERCAST_SUN_CUT * cloud)
  const sunOnGround = sunColor.clone().multiplyScalar((sunIntensity * Math.sin(Math.max(elev, 0) * DEG)) / Math.PI)

  // The moon: from civil dusk, if it's up, scaled by its phase (with a floor,
  // so a new moon isn't pitch black).
  const moonColor = new Color(palette.moonlight)
  const moonFade = nightness * smooth(-2, 8, moon.altitude) * (0.35 + 0.65 * moonFraction) * (1 - cloud)
  const moonIntensity = ((MOON_SHARE * target) / (Math.sin(Math.max(moon.altitude, 10) * DEG) * lum(moonColor))) * moonFade
  const moonOnGround = moonColor.clone().multiplyScalar((moonIntensity * Math.sin(Math.max(moon.altitude, 0) * DEG)) / Math.PI)

  // The fill makes up the rest of the target. By day its color is solved so
  // sun + fill sum to neutral (lighting.ts); it turns cool through dusk and
  // a deeper blue at night.
  const direct = elev > -1 ? sunOnGround : moonOnGround
  const needed = new Color(Math.max(0, level - direct.r), Math.max(0, level - direct.g), Math.max(0, level - direct.b))
  const neutralFill = lum(needed) > 1e-6 ? needed.clone().multiplyScalar(1 / lum(needed)) : new Color(1, 1, 1)
  const fillSky = neutralFill
    .lerp(new Color(palette.twilightFill), 1 - dayness)
    .lerp(new Color(palette.nightFill), nightness)
    .lerp(new Color(palette.overcastLight), cloud * dayness)
  const fillIntensity = (Math.max(0, level - lum(direct)) * Math.PI) / lum(fillSky)
  const fillGround = new Color(palette.bounce)
    .lerp(new Color(palette.nightBounce), nightness)
    .lerp(new Color(palette.overcastBounce), cloud * dayness)

  // The sky: Preetham held near the reference brightness at the horizon,
  // times the scene exposure, blending to the night gradient after sunset.
  // Preetham goes dark a couple of degrees below the horizon, so from just
  // before sunset it hands over to a gradient: blue hour first, then night.
  const raw = rawHorizonLuminance(sunDirection)
  const skyExposure =
    raw > 1e-9 ? Math.min(SKY_EXPOSURE * 6, Math.max(SKY_EXPOSURE * 0.3, (REFERENCE_HORIZON * exposure) / raw)) : SKY_EXPOSURE
  const night = 1 - smooth(-5, 1, elev)
  const sky: SkyLook = {
    sunDirection,
    exposure: skyExposure,
    night,
    nightZenith: new Color(palette.twilightSkyZenith).lerp(new Color(palette.nightSkyZenith), nightness),
    nightHorizon: new Color(palette.twilightSkyHorizon).lerp(new Color(palette.nightSkyHorizon), nightness),
    glowColor: new Color(palette.twilightGlow),
    glow: 1 - nightness,
    overcast: cloud,
    overcastZenith: new Color(palette.overcastZenith).multiplyScalar(level).lerp(new Color(palette.overcastNightZenith), night),
    overcastHorizon: new Color(palette.overcastHorizon).multiplyScalar(level).lerp(new Color(palette.overcastNightHorizon), night),
  }

  return {
    date,
    hour: sfHour(date),
    weekend: sfIsWeekend(date),
    sunElevation: elev,
    sunDirection,
    moonElevation: moon.altitude,
    moonDirection,
    moonFraction,
    exposure,
    light:
      elev > -1
        ? { direction: sunDirection, color: sunColor, intensity: sunIntensity, isMoon: false }
        : { direction: moonDirection, color: moonColor, intensity: moonIntensity, isMoon: true },
    fill: { sky: fillSky, ground: fillGround, intensity: fillIntensity },
    sky,
    haze: hazeColor(sky),
    windowsOn: 1 - smooth(-6, 3, elev),
    cloud,
    fog: {
      density: fogDensity(weather.visibilityM),
      // Day: the fog's gray-white, with the light. Night: lit from below by
      // the city, a dim orange-gray glow.
      color: new Color(palette.fogDay).multiplyScalar(level).lerp(new Color(palette.fogNight), night),
      top: FOG_TOP_M,
      soft: FOG_SOFT_M,
      ramp: FOG_RAMP_M,
      glow: FOG_WINDOW_GLOW * (1 - smooth(-6, 3, elev)),
    },
  }
}
