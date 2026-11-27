#!/usr/bin/env node
/**
 * Layout audit of the Console's own pages (c111-layout-audit-console-pages, zhinjs/zhin ADR 0063 D20 第 3 条):
 * runs `@zhin.js/console-ui/audit` over the main pages of the production build, signed in to the read-only
 * UI fixture (`scripts/ui-preview-host.mjs`, synthetic token `ui-preview`). Report only: it writes the
 * report and always exits 0 unless the audit itself could not run (CI also marks the job continue-on-error).
 *
 *   pnpm build
 *   node scripts/ui-preview-host.mjs &        # 127.0.0.1:18087
 *   pnpm preview &                            # 127.0.0.1:5173
 *   pnpm exec playwright install chromium     # or CHROME_PATH=/path/to/chrome
 *   node scripts/layout-audit.mjs [route …]
 *
 * Environment: CONSOLE_URL (default http://127.0.0.1:5173), UI_PREVIEW_HOST (default http://127.0.0.1:18087),
 * CHROME_PATH (a local Chrome / Chromium instead of Playwright's), LAYOUT_AUDIT_OUT (report file,
 * default layout-audit-report.txt; the JSON lands next to it), LAYOUT_AUDIT_WIDTHS (e.g. `375,1280`).
 */
import { writeFile } from 'node:fs/promises'
import { chromium } from 'playwright'
import { AUDIT_WIDTHS, formatAuditReport, runLayoutAudit, setConsoleTheme } from '@zhin.js/console-ui/audit'

const consoleUrl = (process.env.CONSOLE_URL ?? 'http://127.0.0.1:5173').replace(/\/$/u, '')
const host = process.env.UI_PREVIEW_HOST ?? 'http://127.0.0.1:18087'
const out = process.env.LAYOUT_AUDIT_OUT ?? 'layout-audit-report.txt'
const widths = process.env.LAYOUT_AUDIT_WIDTHS ? process.env.LAYOUT_AUDIT_WIDTHS.split(',').map(Number).filter(Boolean) : AUDIT_WIDTHS

/** The Console's main pages: one per navigation section, plus the plugin list and the model page. */
const DEFAULT_ROUTES = [
  '/dashboard', '/logs', '/scope', '/features', '/features/ai', '/plugins', '/marketplace',
  '/ops/config', '/ops/env', '/ops/schedules', '/ops/instance', '/access/users',
]
const routes = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ROUTES

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {})
const context = await browser.newContext()
const page = await context.newPage()

// Sign in once with a login link; the Console asks before connecting to a Host it has not saved.
await page.goto(`${consoleUrl}/#apiBaseUrl=${encodeURIComponent(host)}&token=ui-preview`)
const confirm = page.getByRole('dialog').getByRole('button', { name: /^(连接|Connect)$/u })
await confirm.click({ timeout: 10_000 }).catch(() => {})
await page.waitForURL(url => url.pathname !== '/' && !url.pathname.endsWith('/login'), { timeout: 15_000 }).catch(() => {
  throw new Error('could not sign in to the UI fixture (is scripts/ui-preview-host.mjs running?)')
})

const results = []
for (const route of routes) {
  try {
    const report = await runLayoutAudit(page, {
      widths,
      // Switch the theme the library's way, then let the 120–280ms colour transitions finish: measured
      // mid-transition, a row still has its light background under dark text (a false contrast failure).
      setTheme: async (target, theme) => {
        await setConsoleTheme(target, theme)
        await target.waitForTimeout(600)
      },
      open: async (target) => {
        // Not `networkidle`: the Console keeps an SSE stream (`/api/events`) open.
        await target.goto(`${consoleUrl}${route}`, { waitUntil: 'load' })
        await target.waitForSelector('[data-slot=page-content], main', { timeout: 15_000 }).catch(() => {})
        await target.waitForTimeout(1_500)
      },
    })
    results.push({ route, violations: report.violations })
  } catch (error) {
    results.push({ route, error: error instanceof Error ? error.message : String(error), violations: [] })
  }
}
await browser.close()

const text = results.map(({ route, error, violations }) => `## ${route}\n${error ? `audit failed: ${error}` : formatAuditReport({ violations })}`).join('\n\n')
const total = results.reduce((sum, item) => sum + item.violations.length, 0)
const summary = `Console layout audit (report only): ${routes.length} page(s), ${total} violation(s)\n\n${text}\n`
await writeFile(out, summary)
await writeFile(out.replace(/\.txt$/u, '') + '.json', JSON.stringify(results, null, 2))
console.log(summary)
if (results.every(item => item.error)) process.exitCode = 1
