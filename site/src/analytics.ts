// Anonymous visit counts with GoatCounter (no cookies). The site's pages live after the "#",
// which GoatCounter ignores, so automatic counting is off and each page change is counted here.
// GoatCounter itself skips localhost, so local testing isn't counted.

const ENDPOINT = 'https://stevendawkins.goatcounter.com/count'

interface GoatCounter {
  count: (vars: { path: string; title?: string; event?: boolean }) => void
}
declare global {
  interface Window {
    goatcounter?: GoatCounter
  }
}

type Hit = Parameters<GoatCounter['count']>[0]
let pending: Hit[] | null = []

function send(hit: Hit) {
  if (pending) pending.push(hit) // script still loading
  else window.goatcounter?.count(hit)
}

function load() {
  const script = document.createElement('script')
  script.async = true
  script.src = 'https://gc.zgo.at/count.js'
  script.dataset.goatcounter = ENDPOINT
  script.dataset.goatcounterSettings = JSON.stringify({ no_onload: true })
  script.onload = () => {
    const queued = pending ?? []
    pending = null
    queued.forEach(send)
  }
  script.onerror = () => {
    pending = null // blocked by an ad blocker or offline: drop counts quietly
  }
  document.head.appendChild(script)
}
load()

/** A page view, e.g. "/bib/1234". */
export function trackPage(path: string) {
  send({ path })
}

/** Something a visitor did, e.g. "download-original". */
export function trackEvent(name: string, title?: string) {
  send({ path: name, title, event: true })
}
