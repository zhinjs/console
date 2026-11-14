/**
 * Terminal log lines → display segments (zhinjs/zhin#1250 `instance-log-ansi`).
 *
 * The gateway forwards the instance's stdout / stderr verbatim, colour codes included. Only SGR
 * (`ESC [ … m`) foreground colours, bold, dim, italic and underline are kept, mapped to theme
 * tokens (never raw RGB); every other escape sequence (cursor moves, OSC titles, 256 / true
 * colour, backgrounds) is dropped. Some pipelines strip the ESC byte and leave `[90m…[39m`
 * behind; a line with at least two such remnants (and no ESC) is read the same way.
 */

/** Theme tone per SGR foreground code (30–37, 90–97). */
const FOREGROUND = Object.freeze({
  30: 'default', 31: 'danger', 32: 'success', 33: 'warning', 34: 'info', 35: 'accent', 36: 'info', 37: 'default',
  90: 'muted', 91: 'danger', 92: 'success', 93: 'warning', 94: 'info', 95: 'accent', 96: 'info', 97: 'default',
})

export const ANSI_TONES = Object.freeze(['default', 'muted', 'danger', 'success', 'warning', 'info', 'accent'])

// eslint-disable-next-line no-control-regex
const ESCAPES = /\u001b\[([0-9;:?]*)([@-~])|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[@-Z\\-_]|\u009b([0-9;]*)([@-~])/gu
const ORPHAN_SGR = /\[((?:\d{1,3};)*\d{1,3})?m/gu
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/gu

const EMPTY_STYLE = Object.freeze({ tone: null, bold: false, dim: false, italic: false, underline: false })

function applySgr(style, params) {
  const codes = params === '' ? [0] : params.split(/[;:]/u).map(value => (value === '' ? 0 : Number(value)))
  let next = { ...style }
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index]
    if (code === 0) next = { ...EMPTY_STYLE }
    else if (code === 1) next.bold = true
    else if (code === 2) next.dim = true
    else if (code === 3) next.italic = true
    else if (code === 4) next.underline = true
    else if (code === 22) { next.bold = false; next.dim = false }
    else if (code === 23) next.italic = false
    else if (code === 24) next.underline = false
    else if (code === 39) next.tone = null
    else if (Object.hasOwn(FOREGROUND, code)) next.tone = FOREGROUND[code]
    // 38/48;5;n and 38/48;2;r;g;b: skip the colour arguments (not mapped to the theme).
    else if (code === 38 || code === 48) index += codes[index + 1] === 5 ? 2 : codes[index + 1] === 2 ? 4 : 1
  }
  return next
}

function pushSegment(segments, text, style) {
  const clean = text.replace(CONTROL, '')
  if (!clean) return
  const previous = segments[segments.length - 1]
  const same = previous && previous.tone === style.tone && previous.bold === style.bold && previous.dim === style.dim
    && previous.italic === style.italic && previous.underline === style.underline
  if (same) previous.text += clean
  else segments.push({ text: clean, ...style })
}

function hasOrphanSgr(text) {
  if (text.includes('\u001b') || text.includes('\u009b')) return false
  return (text.match(ORPHAN_SGR) ?? []).length >= 2
}

/**
 * `[{ text, tone, bold, dim, italic, underline }]`; `tone` is null (inherit) or one of ANSI_TONES.
 * Plain text comes back as a single segment.
 */
export function parseAnsi(input) {
  const text = typeof input === 'string' ? input : String(input ?? '')
  const pattern = hasOrphanSgr(text) ? new RegExp(`${ESCAPES.source}|${ORPHAN_SGR.source}`, 'gu') : new RegExp(ESCAPES.source, 'gu')
  const segments = []
  let style = { ...EMPTY_STYLE }
  let last = 0
  for (const match of text.matchAll(pattern)) {
    pushSegment(segments, text.slice(last, match.index), style)
    last = match.index + match[0].length
    const csiFinal = match[2] ?? match[4]
    const csiParams = match[1] ?? match[3]
    if (csiFinal === 'm') style = applySgr(style, csiParams ?? '')
    else if (csiFinal === undefined && match[0].startsWith('[') && match[0].endsWith('m')) style = applySgr(style, match[0].slice(1, -1))
  }
  pushSegment(segments, text.slice(last), style)
  return segments
}

/** The line without any escape sequence. */
export function stripAnsi(input) {
  return parseAnsi(input).map(segment => segment.text).join('')
}

const LEADING_TIME = /^\s*\[?\s*(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T])?\d{1,2}:\d{2}:\d{2}(?:[.,]\d{1,6})?/u

/** True when the (escape-free) line starts with its own clock time, e.g. `[13:33:58.147]` or `2026-11-14 13:33:58`. */
export function hasLeadingTime(input) {
  return LEADING_TIME.test(stripAnsi(input))
}
