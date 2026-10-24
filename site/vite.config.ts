import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { sharePages } from './sharePages.ts'

// Where GitHub Pages serves the site: link previews need absolute URLs. VITE_REPO is set by the deploy workflow.
const [owner, repo] = (process.env.VITE_REPO || 'steven-dawkins/abingdon-marathon-photos-2026').split('/')
const SITE_URL = process.env.SITE_URL || `https://${owner}.github.io/${repo}/`

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), sharePages(SITE_URL, 'public/data/photos.json')],
  // Relative paths, so the build works under any GitHub Pages path or a custom domain
  base: './',
})
