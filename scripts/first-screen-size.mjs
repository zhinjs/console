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

/** Local scripts an index.html loads (`<script src=…>`), relative to the dist directory, in order. */
export function firstScreenScripts(html) {
  const scripts = []
  for (const match of String(html).matchAll(/<script\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>/giu)) {
    const src = match[1] ?? match[2] ?? match[3]
    if (/^(?:[a-z]+:)?\/\//iu.test(src)) continue
    scripts.push(src.replace(/^\.?\//u, ''))
  }
  return scripts
}

/** Files, raw and gzip bytes of the first screen's JS in a built dist directory. */
export function firstScreenSize(dist) {
  const scripts = firstScreenScripts(readFileSync(join(dist, 'index.html'), 'utf8'))
  let rawBytes = 0, gzipBytes = 0
  for (const script of scripts) {
    const content = readFileSync(join(dist, script))
    rawBytes += content.length
    gzipBytes += gzipSync(content, { level: 9 }).length
  }
  return { files: scripts.length, rawBytes, gzipBytes }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = resolve(process.argv[2] ?? 'dist')
  const size = firstScreenSize(dist)
  const kb = bytes => `${(bytes / 1024).toFixed(1)} KB`
  console.log(`First screen JS: ${size.files} files, ${kb(size.rawBytes)} raw, ${kb(size.gzipBytes)} gzip (budget ${kb(FIRST_SCREEN_GZIP_BUDGET)})`)
  if (FIRST_SCREEN_GZIP_BUDGET > 0 && size.gzipBytes > FIRST_SCREEN_GZIP_BUDGET) {
    console.error('The first screen grew past its budget: load the new page with lazyPage (console-ui/src/lazy-page.tsx), or raise FIRST_SCREEN_GZIP_BUDGET in scripts/first-screen-size.mjs with a reason.')
    process.exit(1)
  }
}
