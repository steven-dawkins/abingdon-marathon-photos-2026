// Image and page URLs on Flickr. Sizes up to 1024px share the photo's secret; the original has its own.
import type { Album, Photo } from './data'

type SharedSize = 'q' | 'n' | 'z' | 'b' // 150 square, 320, 640, 1024 on the long side

export function imageUrl(photo: Photo, size: SharedSize): string {
  return `https://live.staticflickr.com/${photo.server}/${photo.id}_${photo.secret}_${size}.jpg`
}

export function originalUrl(photo: Photo): string {
  return `https://live.staticflickr.com/${photo.server}/${photo.id}_${photo.originalSecret}_o.jpg`
}

export function photoPageUrl(owner: string, photo: Photo): string {
  return `https://www.flickr.com/photos/${owner}/${photo.id}/`
}

export function albumPageUrl(owner: string, album: Album): string {
  return `https://www.flickr.com/photos/${owner}/albums/${album.id}`
}
