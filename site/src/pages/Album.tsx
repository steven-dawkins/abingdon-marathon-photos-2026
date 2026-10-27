import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PhotoGrid } from '../components/PhotoGrid'
import { useIndex, type Album, type Photo } from '../data'
import { albumPageUrl } from '../flickr'
import { formatClock } from '../time'

const PAGE = 96
const SLOT_SECONDS = 5 * 60

/** One album in time order, shown a window at a time, optionally centred on one photo (?at=id). */
export function AlbumPage() {
  const params = useParams()
  const [search] = useSearchParams()
  const album = useIndex().albums[Number(params.album)]
  const at = search.get('at') ?? undefined
  if (!album) return <p className="empty">Album not found.</p>
  // A new key starts a fresh window when the album or photo changes
  return <AlbumView key={`${album.id}-${at}`} album={album} at={at} />
}

function AlbumView({ album, at }: { album: Album; at?: string }) {
  const index = useIndex()
  const navigate = useNavigate()
  const [range, setRange] = useState(() => initialRange((at && index.photos.get(at)?.position) || 0))
  const [start, end] = range
  const photos = album.photos.slice(start, end)
  const slots = useMemo(() => timeSlots(album.photos), [album])
  const sentinel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // After the layout's scroll-to-top on navigation
    if (at) requestAnimationFrame(() => document.getElementById(`p${at}`)?.scrollIntoView({ block: 'center' }))
  }, [at])

  // Load later photos automatically when the end of the grid scrolls into view
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) setRange(([s, e]) => [s, Math.min(e + PAGE, album.photos.length)])
      },
      { rootMargin: '800px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [album])

  return (
    <>
      <h1>{album.label}</h1>
      <p className="note">
        {album.photos.length.toLocaleString()} photos in the order they were taken. {clockNote(album.clockCorrection)}{' '}
        <a href={albumPageUrl(index.owner, album)} target="_blank" rel="noreferrer">
          Album on Flickr
        </a>
      </p>

      <div className="album-toolbar">
        <label>
          Jump to{' '}
          <select
            value=""
            onChange={(e) => {
              const slot = slots.find((s) => s.time === Number(e.target.value))
              if (slot) navigate(`/album/${album.index}?at=${slot.photo.id}`, { replace: true })
            }}
          >
            <option value="" disabled>
              a time…
            </option>
            {slots.map((s) => (
              <option key={s.time} value={s.time}>
                {formatClock(s.time)} ({s.count})
              </option>
            ))}
          </select>
        </label>
        <nav className="album-nav">
          {album.index > 0 && <Link to={`/album/${album.index - 1}`}>← {index.albums[album.index - 1].label}</Link>}
          {album.index < index.albums.length - 1 && (
            <Link to={`/album/${album.index + 1}`}>{index.albums[album.index + 1].label} →</Link>
          )}
        </nav>
      </div>

      {start > 0 && (
        <button type="button" className="button more" onClick={() => setRange([Math.max(0, start - PAGE), end])}>
          Show earlier photos
        </button>
      )}
      <PhotoGrid photos={photos} highlight={at} showBibs />
      <div ref={sentinel} />
    </>
  )
}

function clockNote(correction?: number): string {
  if (!correction) return "Times are from the camera's clock."
  const minutes = Math.round(Math.abs(correction) / 60)
  const amount = minutes < 1 ? `${Math.abs(correction)} seconds` : minutes < 60 ? `${minutes} minutes` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
  return `The camera's clock was about ${amount} ${correction > 0 ? 'fast' : 'slow'}, so times have been corrected to match runners' official finish times.`
}

function initialRange(position: number): [number, number] {
  const start = Math.max(0, position - PAGE / 4)
  return [start, start + PAGE]
}

/** 5-minute slots that have photos, each with its first photo. */
function timeSlots(photos: Photo[]) {
  const slots: { time: number; photo: Photo; count: number }[] = []
  for (const photo of photos) {
    const time = Math.floor(photo.time / SLOT_SECONDS) * SLOT_SECONDS
    const last = slots[slots.length - 1]
    if (last?.time === time) last.count++
    else slots.push({ time, photo, count: 1 })
  }
  return slots
}
