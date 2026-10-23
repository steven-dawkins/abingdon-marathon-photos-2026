import { Link } from 'react-router-dom'
import type { Photo } from '../data'
import { imageUrl } from '../flickr'
import { formatClock } from '../time'

export function PhotoGrid({ photos, bib, highlight }: { photos: Photo[]; bib?: string; highlight?: string }) {
  return (
    <ul className="photo-grid">
      {photos.map((photo) => (
        <li key={photo.id} className={photo.id === highlight ? 'highlight' : undefined} id={`p${photo.id}`}>
          <Link to={`/photo/${photo.id}${bib ? `?bib=${bib}` : ''}`} title={`${photo.album.label}, ${formatClock(photo.time)}`}>
            <img
              src={imageUrl(photo, 'n')}
              srcSet={`${imageUrl(photo, 'n')} 320w, ${imageUrl(photo, 'z')} 640w`}
              sizes="(max-width: 600px) 50vw, 240px"
              width={photo.width}
              height={photo.height}
              loading="lazy"
              alt={`Photo at ${photo.album.label}`}
            />
          </Link>
        </li>
      ))}
    </ul>
  )
}

