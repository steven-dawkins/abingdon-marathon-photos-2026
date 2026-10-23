import { useEffect, useState } from 'react'
import type { Photo } from '../data'
import { imageUrl, originalUrl } from '../flickr'

interface Props {
  photo: Photo
  onClose: () => void
  /** Swipe handlers, shared with the photo page */
  swipe: Pick<React.HTMLAttributes<HTMLDivElement>, 'onTouchStart' | 'onTouchEnd'>
}

/**
 * The original photo over the whole screen. The 1024px copy (already loaded on the photo page)
 * shows straight away and the original replaces it when it arrives. Originals count towards
 * Flickr's hourly limit, so if one is refused the 1024px copy stays.
 */
export function Lightbox({ photo, onClose, swipe }: Props) {
  // Keyed on the photo, so stepping to another photo starts loading again
  const [state, setState] = useState<{ id: string; status: 'loading' | 'loaded' | 'failed' }>({ id: photo.id, status: 'loading' })
  const status = state.id === photo.id ? state.status : 'loading'

  useEffect(() => {
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = overflow
    }
  }, [])

  return (
    <div className="lightbox" role="dialog" aria-label="Full-size photo" onClick={onClose} {...swipe}>
      <img src={imageUrl(photo, 'b')} alt="" aria-hidden="true" />
      {status !== 'failed' && (
        <img
          key={photo.id}
          className={status === 'loaded' ? 'original loaded' : 'original'}
          src={originalUrl(photo)}
          alt={`Full-size photo at ${photo.album.label}`}
          onLoad={() => setState({ id: photo.id, status: 'loaded' })}
          onError={() => setState({ id: photo.id, status: 'failed' })}
        />
      )}
      <span className="lightbox-status">
        {status === 'loading' && 'Loading full size…'}
        {status === 'failed' && "Full size isn't available from Flickr right now"}
      </span>
      <button type="button" className="lightbox-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
    </div>
  )
}
