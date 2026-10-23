import { useEffect, useState } from 'react'
import { HashRouter, Link, Route, Routes, useLocation } from 'react-router-dom'
import { CREDIT, reportUrl } from './config'
import { IndexContext, loadIndex, type PhotoIndex } from './data'
import { SearchBox } from './components/SearchBox'
import { Home } from './pages/Home'
import { RunnerPage } from './pages/Runner'
import { PhotoPage } from './pages/Photo'
import { AlbumPage } from './pages/Album'

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  return null
}

function Layout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()
  return (
    <>
      <header className="site-header">
        <div className="wrap header-inner">
          <Link to="/" className="site-title">
            Abingdon Marathon 2026 <span>photos</span>
          </Link>
          {pathname !== '/' && <SearchBox compact />}
        </div>
      </header>
      <main className="wrap">{children}</main>
      <footer className="site-footer">
        <div className="wrap">
          <p>{CREDIT}. Results from ChronoTrack.</p>
          <p>
            Race numbers were read from the photos automatically, so some matches are wrong or missing.{' '}
            <a href={reportUrl({})} target="_blank" rel="noreferrer">
              Report a wrong or missing photo
            </a>
            .
          </p>
        </div>
      </footer>
    </>
  )
}

export default function App() {
  const [index, setIndex] = useState<PhotoIndex | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadIndex().then(setIndex, (e: Error) => setError(e.message))
  }, [])

  return (
    <HashRouter>
      <ScrollToTop />
      {index ? (
        <IndexContext.Provider value={index}>
          <Layout>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/bib/:bib" element={<RunnerPage />} />
              <Route path="/photo/:id" element={<PhotoPage />} />
              <Route path="/album/:album" element={<AlbumPage />} />
              <Route path="*" element={<p className="empty">Page not found.</p>} />
            </Routes>
          </Layout>
        </IndexContext.Provider>
      ) : (
        <p className="loading">{error ?? 'Loading photos…'}</p>
      )}
    </HashRouter>
  )
}
