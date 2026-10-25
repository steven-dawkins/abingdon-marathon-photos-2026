// Loads photos.json (written by build_index.py) and builds the lookups the pages need.
import { createContext, useContext } from 'react'

/**
 * How sure we are a bib read belongs to the runner (see build_index.py): 3 number matches, 2 name
 * matches a number one digit away, 1 name matches part of the number, 0 number isn't a finisher's.
 */
export type Confidence = 0 | 1 | 2 | 3

// The compact shapes stored in photos.json
interface RawPhoto {
  id: string
  a: number
  s: string
  k: string
  ok: string
  w: number
  h: number
  t: number
  r?: 1
  b?: [string, Confidence][]
}
interface RawRunner {
  bib: string
  name: string
  club: string | null
  time: string
  pos: number
  g: Gender
  ag: string
  /** Estimated time passing each of RawIndex.points, by the camera's clock there */
  e?: (number | null)[]
}
interface RawIndex {
  generated: string
  owner: string
  albums: { id: string; title: string; label: string }[]
  points?: { a: number; label: string; w: number }[]
  runners: RawRunner[]
  photos: RawPhoto[]
}

export interface Album {
  index: number
  id: string
  title: string
  label: string
  photos: Photo[] // in time order
}
export type Gender = 'M' | 'F' | 'NB'

/** A place on the course where photos were taken. The "Miles 11 & 19.5" album has two. */
export interface CoursePoint {
  album: Album
  label: string
  /** How far off (in seconds) an estimated passing time can be: 90% of runners were within it */
  window: number
}
export interface Runner {
  bib: string
  name: string
  club: string | null
  time: string
  pos: number
  gender: Gender
  /** "Under 35", "35–39", … "70+" */
  ageGroup: string
  /** When the runner probably passed each place, worked out from their chip times (see build_index.py) */
  passing: { point: CoursePoint; time: number }[]
}
export interface Photo {
  id: string
  album: Album
  /** Position in album.photos */
  position: number
  server: string
  secret: string
  originalSecret: string
  width: number
  height: number
  /** Seconds since the race start, by the camera's clock */
  time: number
  /** Whether the bib reader has looked at this photo yet */
  processed: boolean
  bibs: { bib: string; confidence: Confidence }[]
}
export interface PhotoIndex {
  generated: Date
  owner: string
  albums: Album[]
  photos: Map<string, Photo>
  runners: Map<string, Runner>
  /** Every bib read in any photo, with the photos it was read in */
  photosByBib: Map<string, Photo[]>
  processedCount: number
}

export async function loadIndex(): Promise<PhotoIndex> {
  const resp = await fetch('./data/photos.json')
  if (!resp.ok) throw new Error(`Could not load the photo index (${resp.status})`)
  const raw: RawIndex = await resp.json()

  const albums: Album[] = raw.albums.map((a, index) => ({ ...a, index, photos: [] }))
  const photos = new Map<string, Photo>()
  const photosByBib = new Map<string, Photo[]>()
  let processedCount = 0
  for (const p of raw.photos) {
    const album = albums[p.a]
    const photo: Photo = {
      id: p.id,
      album,
      position: album.photos.length,
      server: p.s,
      secret: p.k,
      originalSecret: p.ok,
      width: p.w,
      height: p.h,
      time: p.t,
      processed: p.r === 1,
      bibs: (p.b ?? []).map(([bib, confidence]) => ({ bib, confidence })),
    }
    album.photos.push(photo)
    photos.set(photo.id, photo)
    if (photo.processed) processedCount++
    for (const { bib } of photo.bibs) {
      const list = photosByBib.get(bib) ?? []
      list.push(photo)
      photosByBib.set(bib, list)
    }
  }

  const points: CoursePoint[] = (raw.points ?? []).map((p) => ({ album: albums[p.a], label: p.label, window: p.w }))
  const runners = raw.runners.map(({ e, g, ag, ...r }): Runner => ({
    ...r,
    gender: g,
    ageGroup: ag,
    passing: (e ?? []).flatMap((time, i) => (time === null ? [] : [{ point: points[i], time }])),
  }))

  return {
    generated: new Date(raw.generated),
    owner: raw.owner,
    albums,
    photos,
    runners: new Map(runners.map((r) => [r.bib, r])),
    photosByBib,
    processedCount,
  }
}

export const IndexContext = createContext<PhotoIndex | null>(null)

export function useIndex(): PhotoIndex {
  const index = useContext(IndexContext)
  if (!index) throw new Error('useIndex used outside IndexContext')
  return index
}

/** "CAMERON WEIR" -> "Cameron": some names were entered all in capitals or lower case */
export function firstName(name: string): string {
  const word = name.split(' ')[0]
  return word === word.toUpperCase() || word === word.toLowerCase() ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word
}

export function confidenceFor(photo: Photo, bib: string): Confidence {
  return photo.bibs.find((b) => b.bib === bib)?.confidence ?? 0
}
