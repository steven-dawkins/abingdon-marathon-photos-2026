import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { PhotoGrid } from '../components/PhotoGrid'
import { useIndex, type Album } from '../data'
import { albumPageUrl } from '../flickr'
import { formatClock } from '../time'

const PAGE = 96

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
  const [range, setRange] = useState(() => initialRange((at && index.photos.get(at)?.position) || 0))

  useEffect(() => {
    // After the layout's scroll-to-top on navigation
    if (at) requestAnimationFrame(() => document.getElementById(`p${at}`)?.scrollIntoView({ block: 'center' }))
  }, [at])

  const [start, end] = range
  const photos = album.photos.slice(start, end)

  return (
    <>
      <h1>{album.label}</h1>
      <p className="note">
        {album.photos.length.toLocaleString()} photos in the order they were taken
        {photos.length > 0 && <>; showing {formatClock(photos[0].time)}–{formatClock(photos[photos.length - 1].time)} by the camera's clock</>}.{' '}
        <a href={albumPageUrl(index.owner, album)} target="_blank" rel="noreferrer">
          Album on Flickr
        </a>
      </p>
      {start > 0 && (
        <button type="button" className="button more" onClick={() => setRange([Math.max(0, start - PAGE), end])}>
          Show earlier photos
        </button>
      )}
      <PhotoGrid photos={photos} highlight={at} />
      {end < album.photos.length && (
        <button type="button" className="button more" onClick={() => setRange([start, end + PAGE])}>
          Show later photos
        </button>
      )}
      <nav className="album-nav">
        {album.index > 0 && <Link to={`/album/${album.index - 1}`}>← {index.albums[album.index - 1].label}</Link>}
        {album.index < index.albums.length - 1 && (
          <Link to={`/album/${album.index + 1}`}>{index.albums[album.index + 1].label} →</Link>
        )}
      </nav>
    </>
  )
}

function initialRange(position: number): [number, number] {
  const start = Math.max(0, position - PAGE / 4)
  return [start, start + PAGE]
}
