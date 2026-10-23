import { useRef, useState } from 'react'
import type { Photo } from '../data'
import { trackEvent } from '../analytics'
import { downloadPhoto, downloadZip, type ZipProgress } from '../download'

export function DownloadPhotoButton({ photo, bib }: { photo: Photo; bib?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')
  const onClick = async () => {
    setState('busy')
    try {
      await downloadPhoto(photo, bib)
      trackEvent('download-original')
      setState('idle')
    } catch {
      setState('error')
    }
  }
  return (
    <button type="button" className="button primary" onClick={onClick} disabled={state === 'busy'}>
      {state === 'busy' ? 'Downloading…' : state === 'error' ? 'Download failed, try again' : 'Download original'}
    </button>
  )
}

// Beyond this Flickr's ~85 originals/hour limit is likely to kick in
const SLOW_ZIP = 60

export function DownloadAllButton({ photos, bib, label }: { photos: Photo[]; bib?: string; label: string }) {
  const [progress, setProgress] = useState<ZipProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  const start = async () => {
    if (photos.length > SLOW_ZIP && !window.confirm(
      `Flickr only allows about 85 full-size downloads an hour, so ${photos.length} photos may take a long time. Continue?`,
    )) return
    abort.current = new AbortController()
    setError(null)
    try {
      trackEvent('download-all', `${photos.length} photos`)
      await downloadZip(photos, bib, setProgress, abort.current.signal)
    } catch (e) {
      if (!abort.current.signal.aborted) setError((e as Error).message)
    }
    setProgress(null)
  }

  if (!progress) {
    return (
      <>
        <button type="button" className="button" onClick={start}>
          {label}
        </button>
        {error && <span className="error">{error}</span>}
      </>
    )
  }
  return (
    <span className="zip-progress">
      <progress max={progress.total} value={progress.done} />
      {progress.waitingSeconds
        ? `Flickr is limiting downloads, waiting ${Math.round(progress.waitingSeconds)}s…`
        : `${progress.done} of ${progress.total}`}
      <button type="button" className="button small" onClick={() => abort.current?.abort()}>
        Cancel
      </button>
    </span>
  )
}
