// Link previews for WhatsApp, Facebook etc. Their crawlers don't run JavaScript and never see the part
// of a URL after "#", so the app's own pages all look like the bare home page to them. This adds Open
// Graph tags to index.html and writes a small static page per race number (bib/<n>/index.html) with
// the runner's name, results and one of their photos, which sends people on to the app's #/bib/<n>.
import { readFileSync } from 'node:fs'
import type { Plugin } from 'vite'

interface RawPhoto {
  id: string
  s: string
  k: string
  w: number
  h: number
  b?: [string, number][]
}
interface RawRunner {
  bib: string
  name: string
  club: string | null
  time: string
  pos: number
}

const SITE_NAME = 'Abingdon Marathon 2026 photos'
const DESCRIPTION = 'Find your photos from the Abingdon Marathon 2026 by race number or name, and download the originals.'

// 640px: big enough for Facebook's large preview, small enough for WhatsApp to show it
const imageUrl = (p: RawPhoto) => `https://live.staticflickr.com/${p.s}/${p.id}_${p.k}_z.jpg`
const imageSize = (p: RawPhoto) => (p.w >= p.h ? [640, Math.round((640 * p.h) / p.w)] : [Math.round((640 * p.w) / p.h), 640])

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function metaTags(tags: { title: string; description: string; url: string; image?: RawPhoto }): string {
  const { title, description, url, image } = tags
  const props: [string, string][] = [
    ['og:type', 'website'],
    ['og:site_name', SITE_NAME],
    ['og:title', title],
    ['og:description', description],
    ['og:url', url],
  ]
  if (image) {
    const [width, height] = imageSize(image)
    props.push(['og:image', imageUrl(image)], ['og:image:width', `${width}`], ['og:image:height', `${height}`])
  }
  return [
    ...props.map(([p, c]) => `<meta property="${p}" content="${escape(c)}" />`),
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
  ].join('\n    ')
}

/** The photo that best shows a runner: matched by number and name, few other runners, landscape. */
function bestPhoto(photos: RawPhoto[], bib: string): RawPhoto | undefined {
  const confidence = (p: RawPhoto) => p.b?.find(([b]) => b === bib)?.[1] ?? 0
  const score = (p: RawPhoto) => confidence(p) * 100 - (p.b?.length ?? 0) * 10 + (p.w >= p.h ? 5 : 0)
  return photos.reduce<RawPhoto | undefined>((best, p) => (!best || score(p) > score(best) ? p : best), undefined)
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${suffix}`
}

export function sharePages(siteUrl: string, indexPath: string): Plugin {
  const index: { runners: RawRunner[]; photos: RawPhoto[] } = JSON.parse(readFileSync(indexPath, 'utf-8'))
  const photosByBib = new Map<string, RawPhoto[]>()
  for (const p of index.photos) for (const [bib] of p.b ?? []) photosByBib.set(bib, [...(photosByBib.get(bib) ?? []), p])
  const runners = new Map(index.runners.map((r) => [r.bib, r]))
  // For the home page: the photo with the most runners recognised in it
  const busiest = index.photos
    .filter((p) => p.w > p.h)
    .reduce((a, b) => ((b.b?.filter(([, c]) => c === 3).length ?? 0) > (a.b?.filter(([, c]) => c === 3).length ?? 0) ? b : a))

  return {
    name: 'share-pages',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('</head>', `  ${metaTags({ title: SITE_NAME, description: DESCRIPTION, url: siteUrl, image: busiest })}\n  </head>`)
    },
    generateBundle() {
      for (const [bib, photos] of photosByBib) {
        const runner = runners.get(bib)
        const sure = photos.filter((p) => p.b?.some(([b, c]) => b === bib && c === 3)).length
        const title = runner ? `${runner.name}: Abingdon Marathon 2026 photos` : `Race number ${bib}: Abingdon Marathon 2026 photos`
        const description = [
          sure ? plural(sure, 'photo') + (sure < photos.length ? ` (and ${photos.length - sure} possible)` : '') : plural(photos.length, 'possible photo'),
          runner && `Finished in ${runner.time}, ${ordinal(runner.pos)} of ${runners.size.toLocaleString('en-GB')}`,
          runner?.club,
        ]
          .filter(Boolean)
          .join(' · ')
        const app = `../../#/bib/${bib}`
        this.emitFile({
          type: 'asset',
          fileName: `bib/${bib}/index.html`,
          source: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escape(title)}</title>
    <meta name="description" content="${escape(description)}" />
    ${metaTags({ title, description, url: `${siteUrl}bib/${bib}/`, image: bestPhoto(photos, bib) })}
    <meta http-equiv="refresh" content="0; url=${app}" />
    <script>location.replace(${JSON.stringify(app)})</script>
  </head>
  <body>
    <p><a href="${app}">${escape(title)}</a></p>
  </body>
</html>
`,
        })
      }
    },
  }
}
