#!/usr/bin/env node
// First-screen JS budget (#64 `route-code-splitting-rest`): the scripts dist/index.html loads before any
// route opens — what the sign-in page downloads — gzip-compressed and summed. Pages loaded on demand
// (lazyPage) are not in index.html, so they do not count. `pnpm build` runs this after `farm build`
// and fails when the total grows past the budget, so the first screen cannot quietly grow back.
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

/** Budget for the first screen's JS, gzip bytes (2026-11-26: 903 KB before splitting the routes, 506 KB after; the rest is headroom). */
export const FIRST_SCREEN_GZIP_BUDGET = 540 * 1024

/**
 * Local scripts an index.html loads (`<script src=…>`), as paths inside the dist directory, in order:
 * commented-out tags are ignored, a query or hash is dropped, and the site base (`CONSOLE_PAGES_BASE`,
 * e.g. `/console` for GitHub Pages under a sub-path; farm.config.ts uses it as publicPath) is removed.
 */
export function firstScreenScripts(html, base = '') {
  const prefix = String(base ?? '').replace(/^\/+|\/+$/gu, '')
  const scripts = []
  const markup = String(html).replace(/<!--[\s\S]*?-->/gu, '')
  for (const tag of markup.matchAll(/<script\b[^>]*>/giu)) {
    const match = /\ssrc=(?:"([^"]+)"|'([^']+)'|([^\s>]+))/iu.exec(tag[0])
    if (!match) continue
    const src = match[1] ?? match[2] ?? match[3]
    if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//iu.test(src)) continue
    let path = src.replace(/[?#].*$/u, '').replace(/^\.?\//u, '')
    if (prefix && path.startsWith(`${prefix}/`)) path = path.slice(prefix.length + 1)
    scripts.push(path)
  }
  return scripts
}

/** Files, raw and gzip bytes of the first screen's JS in a built dist directory. */
export function firstScreenSize(dist, base = '') {
  const scripts = firstScreenScripts(readFileSync(join(dist, 'index.html'), 'utf8'), base)
  let rawBytes = 0, gzipBytes = 0
  for (const script of scripts) {
    let content
    try { content = readFileSync(join(dist, script)) } catch {
      throw new Error(`index.html loads ${script}, which is not in ${dist} (is CONSOLE_PAGES_BASE the base the build used?)`)
    }
    rawBytes += content.length
    gzipBytes += gzipSync(content, { level: 9 }).length
  }
  return { files: scripts.length, rawBytes, gzipBytes }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = resolve(process.argv[2] ?? 'dist')
  let size
  try { size = firstScreenSize(dist, process.env.CONSOLE_PAGES_BASE ?? '') } catch (error) {
    console.error(`First screen size check failed: ${error instanceof Error ? error.message : error}`)
    process.exit(1)
  }
  const kb = bytes => `${(bytes / 1024).toFixed(1)} KB`
  console.log(`First screen JS: ${size.files} files, ${kb(size.rawBytes)} raw, ${kb(size.gzipBytes)} gzip (budget ${kb(FIRST_SCREEN_GZIP_BUDGET)})`)
  if (FIRST_SCREEN_GZIP_BUDGET > 0 && size.gzipBytes > FIRST_SCREEN_GZIP_BUDGET) {
    console.error('The first screen grew past its budget: load the new page with lazyPage (console-ui/src/lazy-page.tsx), or raise FIRST_SCREEN_GZIP_BUDGET in scripts/first-screen-size.mjs with a reason.')
    process.exit(1)
  }
}
