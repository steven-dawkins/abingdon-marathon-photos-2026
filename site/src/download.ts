// Downloads originals straight from Flickr. Its image server allows cross-origin fetches, so the
// browser can save them under a useful name or zip them. Flickr limits originals to roughly 85 an
// hour per IP address, so bulk downloads go one at a time and back off when refused.
import { zipSync } from 'fflate'
import type { Photo } from './data'
import { originalUrl } from './flickr'

const PACE_MS = 1000
const BACKOFF_START_MS = 60_000
const BACKOFF_MAX_MS = 10 * 60_000
const MAX_ATTEMPTS = 8

export function fileName(photo: Photo, bib?: string): string {
  const label = photo.album.label.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return ['Abingdon-Marathon-2026', bib, label, photo.id].filter(Boolean).join('_') + '.jpg'
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    })
  })

/**
 * Fetch one original, waiting and retrying while Flickr rate-limits us. A refused request often
 * fails as a network error rather than a 429, because the error page has no CORS header.
 */
async function fetchOriginal(photo: Photo, signal?: AbortSignal, onWait?: (seconds: number) => void) {
  let backoff = BACKOFF_START_MS
  for (let attempt = 1; ; attempt++) {
    let status = 0
    try {
      const resp = await fetch(originalUrl(photo), { signal })
      if (resp.ok) return new Uint8Array(await resp.arrayBuffer())
      status = resp.status
    } catch (e) {
      if (signal?.aborted) throw e
    }
    if (attempt >= MAX_ATTEMPTS || (status && status !== 429 && status < 500)) {
      throw new Error(`Flickr refused photo ${photo.id}${status ? ` (HTTP ${status})` : ''}`)
    }
    onWait?.(backoff / 1000)
    await sleep(backoff, signal)
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
  }
}

export async function downloadPhoto(photo: Photo, bib?: string) {
  const data = await fetchOriginal(photo)
  saveBlob(new Blob([data], { type: 'image/jpeg' }), fileName(photo, bib))
}

export interface ZipProgress {
  done: number
  total: number
  /** Set while waiting for Flickr's rate limit to clear */
  waitingSeconds?: number
}

export async function downloadZip(
  photos: Photo[],
  bib: string | undefined,
  onProgress: (p: ZipProgress) => void,
  signal: AbortSignal,
) {
  const files: Record<string, Uint8Array> = {}
  for (const [i, photo] of photos.entries()) {
    onProgress({ done: i, total: photos.length })
    if (i > 0) await sleep(PACE_MS, signal)
    files[fileName(photo, bib)] = await fetchOriginal(photo, signal, (seconds) =>
      onProgress({ done: i, total: photos.length, waitingSeconds: seconds }),
    )
  }
  onProgress({ done: photos.length, total: photos.length })
  // JPEGs don't compress further, so store them as they are
  const zip = zipSync(files, { level: 0 })
  saveBlob(new Blob([zip], { type: 'application/zip' }), `Abingdon-Marathon-2026${bib ? `_${bib}` : ''}.zip`)
}
