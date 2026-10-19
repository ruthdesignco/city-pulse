import { use } from 'react'
import type { RoutesFile } from './routes-format.ts'
import { type ShapeIndex, buildShapeIndex } from './shapes.ts'

export interface Routes {
  file: RoutesFile
  index: ShapeIndex
  typeByRoute: Map<string, number> // GTFS route_type
}

let routesPromise: Promise<Routes> | undefined

function loadRoutes(): Promise<Routes> {
  routesPromise ??= fetch('/routes.json')
    .then((res) => {
      if (!res.ok) throw new Error(`routes.json: HTTP ${res.status}. Run \`npm run bake:routes\` first.`)
      return res.json() as Promise<RoutesFile>
    })
    .then((file) => ({
      file,
      index: buildShapeIndex(file),
      typeByRoute: new Map(file.routes.map((r) => [r.id, r.type])),
    }))
  return routesPromise
}

// Suspends until public/routes.json is fetched and indexed.
export function useRoutes(): Routes {
  return use(loadRoutes())
}
