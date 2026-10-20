// Facade materials pinned for landmark towers, which would otherwise get
// the random per-building choice (src/city/facade.ts isStoneTower). Matched
// by the outline's exact OSM `name`; the bake fails if a name matches
// nothing, so a renamed tag can't silently drop a pin.
//
// Codes are src/city/facade.ts PinnedMaterial.
//
// Sources (English Wikipedia, checked 2026-10-19):
//   Salesforce Tower        "a glass and steel curtain wall"
//   Millennium Tower        "blue-gray glass"
//   One Rincon Hill         "a linear glass curtainwall" (South Tower)
//   555 California Street   "clad in ... carnelian granite": dark red-brown
//   Transamerica Pyramid    "façade is covered in crushed quartz, giving the
//                           building its light color"
//   181 Fremont Tower       glass, by the project owner's direction; its
//                           Wikipedia article doesn't state the facade

import { PinnedMaterial } from '../../src/city/facade.ts'

export const LANDMARK_MATERIALS: Record<string, PinnedMaterial> = {
  'Salesforce Tower': PinnedMaterial.Glass,
  '181 Fremont Tower': PinnedMaterial.Glass,
  'Millennium Tower': PinnedMaterial.Glass,
  'One Rincon Hill': PinnedMaterial.Glass,
  '555 California Street': PinnedMaterial.Granite,
  'Transamerica Pyramid': PinnedMaterial.PaleStone,
}
