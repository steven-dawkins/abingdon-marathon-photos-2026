// Photos found by when a runner passed a place, rather than by their bib (see build_index.py).
import type { CoursePoint, Photo, Runner } from './data'

/** Places whose passing-time estimates are this close (in seconds) list their photos outright */
export const LIST_WITHIN = 30

export interface Passed {
  point: CoursePoint
  time: number
  photos: Photo[]
}

/**
 * Photos taken within seconds of the runner passing, at places where that can be worked out so
 * closely, leaving out the ones their bib was read in (listed).
 */
export function photosAsPassed(runner: Runner, listed: Photo[]): Passed[] {
  const ids = new Set(listed.map((p) => p.id))
  return runner.passing
    .filter(({ point }) => point.window <= LIST_WITHIN)
    .map(({ point, time }) => ({
      point,
      time,
      photos: point.album.photos.filter((p) => Math.abs(p.time - time) <= point.window && !ids.has(p.id)),
    }))
    .filter(({ photos }) => photos.length > 0)
}
