import type { Photo } from './data'

/** "owner/name" of the GitHub repo, set by the deploy workflow from GITHUB_REPOSITORY. */
export const REPO: string = import.meta.env.VITE_REPO || 'steven-dawkins/abingdon-marathon-photos-2026'

export const CREDIT = 'Photos © the Abingdon Marathon photographers and organisers, via Flickr'

/** A new GitHub issue, prefilled with whatever the reporter was looking at. */
export function reportUrl(opts: { bib?: string; photo?: Photo; flickrUrl?: string }): string {
  const lines = [
    'What is wrong or missing?',
    '',
    '',
    '---',
    opts.bib && `Bib: ${opts.bib}`,
    opts.photo && `Photo: ${opts.photo.id} (${opts.photo.album.label})`,
    opts.flickrUrl && `Flickr: ${opts.flickrUrl}`,
    `Page: ${window.location.href}`,
  ].filter((line): line is string => typeof line === 'string')
  const title = opts.bib ? `Wrong or missing photo for bib ${opts.bib}` : 'Wrong or missing photo'
  const params = new URLSearchParams({ title, body: lines.join('\n') })
  return `https://github.com/${REPO}/issues/new?${params}`
}
