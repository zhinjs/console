import { readBackMismatch, secretLikeKey } from '../components/apply-outcome-model.mjs'
import { SECRET_MASK, SECRET_MASK_CHAR, SECRET_MASK_REVEAL_MIN_LENGTH, SECRET_MASK_RUN, maskSecretText } from '../utils/secret-mask.mjs'
const secretName = /PASSWORD|SECRET|TOKEN|KEY|PRIVATE|CREDENTIAL/i
// ---- Masking: the Host's rule (`../utils/secret-mask.mjs`, zhinjs/zhin#1250) ----
// Every masked value is built with it, so the Console never shows more than the Host would.
// Values are masked as dotenv reads them (quotes, inline comments and surrounding spaces removed).

/** One masked character; a run of ENV_MASK_RUN of them stands for the hidden part. */
export const ENV_MASK_CHAR = SECRET_MASK_CHAR
export const ENV_MASK_RUN = SECRET_MASK_RUN
/** Values shorter than this are masked completely; longer ones show their first and last two characters. */
export const ENV_MASK_REVEAL_MIN_LENGTH = SECRET_MASK_REVEAL_MIN_LENGTH
const MASK_RUN = SECRET_MASK

/** The Host's mask of a value as the process reads it: `''`, the mask alone, or 2 + mask + 2 characters. */
export const maskEnvValueAsRead = maskSecretText

// dotenv 17's own line pattern (`lib/main.js` `LINE`), as the Host's gateway scans `.env` with it.
const DOTENV_LINE = /(?:^|^)\s*(?:export\s+)?([\w.-]+)(?:\s*=\s*?|:\s+?)(\s*'(?:\\'|[^'])*'|\s*"(?:\\"|[^"])*"|\s*`(?:\\`|[^`])*`|[^#\r\n]+)?\s*(?:#.*)?(?:$|$)/mg

/**
 * The value dotenv reads from `KEY=<raw>` (the Host masks that, not the text as written): the
 * captured value trimmed, matching surrounding quotes removed, `\n` / `\r` expanded in double quotes.
 */
export function envValueAsRead(raw) {
  const text = `K=${String(raw ?? '')}`.replace(/\r\n?/g, '\n')
  const match = new RegExp(DOTENV_LINE.source, DOTENV_LINE.flags).exec(text)
  let value = (match?.[2] ?? '').trim()
  const maybeQuote = value[0]
  value = value.replace(/^(['"`])([\s\S]*)\1$/mg, '$2')
  if (maybeQuote === '"') value = value.replace(/\\n/g, '\n').replace(/\\r/g, '\r')
  return value
}

/** Mask of a value as written after `KEY=` (quotes included), by the Host's rule. */
const mask = raw => maskEnvValueAsRead(envValueAsRead(raw))
const assignmentLine = /^(\s*(?:export\s+)?)([\w.-]+)(\s*=\s*)(.*)$/
const validKey = /^[\w.-]+$/

function quoteEnds(value, quote, start = 0) {
  for (let i = start; i < value.length; i++) {
    if (value[i] !== quote) continue
    let escapes = 0
    for (let j = i - 1; j >= 0 && value[j] === '\\'; j--) escapes++
    if (escapes % 2 === 0) return true
  }
  return false
}

export function maskEnvContent(content) {
  let continuation = null
  return content.split(/(\r\n|\n|\r)/).map((line, index) => {
    if (index % 2) return line
    if (continuation) {
      const { quote, secret } = continuation
      if (quoteEnds(line, quote)) continuation = null
      return secret && line ? MASK_RUN : line
    }
    const assignment = line.match(assignmentLine)
    if (!assignment) return line
    const [, before, name, equals, value] = assignment
    const secret = secretName.test(name)
    const quote = /^["'`]/.test(value) ? value[0] : null
    const open = quote && !quoteEnds(value, quote, 1)
    if (open) continuation = { quote, secret }
    // Preserve only a complete variable reference, never a reference followed by a literal secret.
    if (!secret || !value.trim() || /^\$\{[^}]+\}$/.test(value.trim())) return line
    // The first line of a multi-line value is not a value of its own: the fixed mask only.
    return before + name + equals + (open ? MASK_RUN : mask(value) || MASK_RUN)
  }).join('')
}

/**
 * Split a file into assignment entries and untouched text (comments, blank lines, anything
 * unparsed). Serializing the segments reproduces the input byte for byte.
 */
function segments(content) {
  const parts = content.split(/(\r\n|\n|\r)/)
  const out = []
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i]
    let eol = parts[i + 1] ?? ''
    const match = line.match(assignmentLine)
    if (!match) {
      if (line || eol) out.push({ kind: 'text', raw: line + eol })
      continue
    }
    let value = match[4]
    const quote = /^["'`]/.test(value) ? value[0] : null
    if (quote && !quoteEnds(value, quote, 1)) {
      while (i + 2 < parts.length) {
        i += 2
        value += eol + parts[i]
        eol = parts[i + 1] ?? ''
        if (quoteEnds(parts[i], quote)) break
      }
    }
    out.push({ kind: 'entry', before: match[1], key: match[2], equals: match[3], value, eol })
  }
  return out
}

const serialize = segs => segs.map(seg => seg.kind === 'text' ? seg.raw : seg.before + seg.key + seg.equals + seg.value + seg.eol).join('')
const lineEnding = content => content.match(/\r\n|\n|\r/)?.[0] ?? '\n'

/** Whether a value must stay masked until the user explicitly reveals or edits that row. */
export function isSecretEnvEntry(key, value) {
  const trimmed = String(value ?? '').trim()
  return secretName.test(key) && Boolean(trimmed) && !/^\$\{[^}]+\}$/.test(trimmed)
}

/** Mask of a row's value as written (legacy editor), by the Host's rule. */
export function maskEnvValue(value) {
  return mask(value)
}

/**
 * One row per variable. A key assigned more than once is listed once with its effective (last)
 * value; editing or deleting the row applies to every assignment of that key.
 */
export function parseEnvRows(content) {
  // Map keeps first-insertion order while later assignments overwrite the value.
  const rows = new Map()
  for (const seg of segments(content)) {
    if (seg.kind === 'entry') rows.set(seg.key, { key: seg.key, value: seg.value, secret: isSecretEnvEntry(seg.key, seg.value) })
  }
  return [...rows.values()]
}

function appendEntry(content, key, value) {
  const eol = lineEnding(content)
  const separator = content && !/[\r\n]$/.test(content) ? eol : ''
  return `${content}${separator}${key}=${value}${eol}`
}

/** Replace one variable's name/value in place; every other line keeps its exact bytes. */
export function updateEnvRow(content, key, next) {
  const segs = segments(content)
  for (const seg of segs) {
    if (seg.kind !== 'entry' || seg.key !== key) continue
    seg.key = next.key
    seg.value = next.value
  }
  return serialize(segs)
}

export function removeEnvRow(content, key) {
  return serialize(segments(content).filter(seg => seg.kind !== 'entry' || seg.key !== key))
}

export function appendEnvRow(content, { key, value }) {
  return appendEntry(content, key, value)
}

/** @returns null when the row may be applied, otherwise an error code the page translates. */
export function validateEnvRow(content, { key, value }, originalKey) {
  const name = String(key ?? '').trim()
  if (!name) return 'key-required'
  if (!validKey.test(name)) return 'key-invalid'
  if (name !== originalKey && parseEnvRows(content).some(row => row.key === name)) return 'key-duplicate'
  const text = String(value ?? '')
  if (isEnvMaskPlaceholder(text)) return 'value-masked'
  if (/[\r\n]/.test(text)) {
    const quote = /^["'`]/.test(text) ? text[0] : null
    if (!quote || !quoteEnds(text, quote, 1)) return 'value-multiline'
  }
  return null
}

/** The per-key changes between the loaded file and the draft: only these are written. */
export function diffEnvContent(original, draft) {
  const before = new Map(parseEnvRows(original).map(row => [row.key, row.value]))
  const after = parseEnvRows(draft)
  const changes = []
  for (const row of after) {
    if (!before.has(row.key) || before.get(row.key) !== row.value) changes.push({ type: 'set', key: row.key, value: row.value })
  }
  const kept = new Set(after.map(row => row.key))
  for (const key of before.keys()) if (!kept.has(key)) changes.push({ type: 'delete', key })
  return changes
}

/**
 * Apply per-key changes to the file as it is on the Host now. The Host only accepts a whole file,
 * so every line the user did not change is copied from that fresh content, never from a display.
 */
export function applyEnvChanges(base, changes) {
  let content = base
  for (const change of changes) {
    if (change.type === 'delete') { content = removeEnvRow(content, change.key); continue }
    if (isEnvMaskPlaceholder(change.value)) throw new Error(`Refusing to write a masked placeholder for ${change.key}`)
    content = parseEnvRows(content).some(row => row.key === change.key)
      ? updateEnvRow(content, change.key, { key: change.key, value: change.value })
      : appendEntry(content, change.key, change.value)
  }
  return content
}

export function envEditorAccess({ loaded, readOnly, saving, dirty, editing = false }) {
  return {
    canEdit: loaded && !readOnly && !saving,
    canSave: loaded && !readOnly && !saving && dirty && !editing,
  }
}

/**
 * Whether the file read back after a save holds the variables that were written. Formatting the Host
 * may normalise (quotes, blank lines, comments) does not count; a different, missing or extra value
 * does. Secrets are masked in the result (by the Host's rule, which never tells the length).
 */
export function envReadBackMismatch(submitted, readBack) {
  if (submitted === readBack) return null
  // Compare what dotenv reads: matching surrounding quotes are syntax, not part of the value.
  const unquote = value => /^(["'`])[\s\S]*\1$/u.test(value) && value.length >= 2 ? value.slice(1, -1) : value
  const values = text => Object.fromEntries(parseEnvRows(text).map(row => [row.key, unquote(row.value)]))
  const secrets = new Set([...parseEnvRows(submitted), ...parseEnvRows(readBack)].filter(row => row.secret || secretLikeKey(row.key)).map(row => row.key))
  const result = readBackMismatch(values(submitted), values(readBack), { isSecret: path => secrets.has(path[0]) || secretName.test(path[0] ?? '') })
  if (!result?.masked) return result
  // A secret is shown by the Host's mask (fixed width), not the generic mask with its length.
  const raw = text => new Map(parseEnvRows(text).map(row => [row.key, row.value]))
  const show = value => value === undefined ? null : maskEnvValue(value)
  return Object.freeze({ ...result, submitted: show(raw(submitted).get(result.path)), readBack: show(raw(readBack).get(result.path)) })
}

// ---- Masked Hosts (zhinjs/zhin#1250) ----
// `env:get` answers `{ format: 'masked', variables, lines }` without any value; `env:reveal` returns
// one value; `env:save { changes }` writes only the submitted keys. Older Hosts answer `{ content }`.

/** `{ kind: 'masked', view }` for a masking Host, `{ kind: 'legacy', content }` for an older one. */
export function readEnvReply(data) {
  if (data && typeof data === 'object' && data.format === 'masked' && Array.isArray(data.variables) && Array.isArray(data.lines)) {
    const variables = data.variables
      .filter(item => item && typeof item.key === 'string')
      .map(item => ({
        key: item.key,
        // Hosts before #1250's review also sent a `length`; it is not kept (the mask never tells it).
        masked: typeof item.masked === 'string' ? item.masked : MASK_RUN,
        hasValue: item.hasValue === true,
        ...(item.isReference === true ? { isReference: true } : {}),
      }))
    return { kind: 'masked', view: { file: String(data.file ?? ''), variables } }
  }
  return { kind: 'legacy', content: typeof data?.content === 'string' ? data.content : '' }
}

/** A value typed here (written verbatim after `KEY=`), masked exactly as the Host's `env:get` would show it. */
export function maskEnvDisplay(value) {
  return mask(value)
}

/** A masked value sent back by mistake: three mask characters in a row, or only mask characters. */
export function isEnvMaskPlaceholder(value) {
  const text = String(value ?? '')
  const inner = text.trim().replace(/^(["'`])([\s\S]*)\1$/u, '$2').trim()
  return text.includes(ENV_MASK_CHAR.repeat(3)) || (inner.length > 0 && [...inner].every(char => char === ENV_MASK_CHAR))
}

/**
 * Rows of a masked file with the pending changes applied: deleted keys drop out, changed keys carry
 * `pending` (the value typed here), new keys follow in the order they were added.
 */
export function maskedEnvRows(view, changes) {
  const byKey = new Map(changes.map(change => [change.key, change]))
  const rows = []
  for (const variable of view.variables) {
    const change = byKey.get(variable.key)
    if (change?.delete) continue
    rows.push({ ...variable, ...(change ? { pending: change.value } : {}) })
  }
  const known = new Set(view.variables.map(variable => variable.key))
  for (const change of changes) {
    if (change.delete || known.has(change.key)) continue
    rows.push({ key: change.key, masked: maskEnvDisplay(change.value), hasValue: envValueAsRead(change.value).length > 0, pending: change.value, added: true })
  }
  return rows
}

/** Record setting `key`; a later change of the same key replaces the earlier one. */
export function setEnvChange(changes, key, value) {
  return [...changes.filter(change => change.key !== key), { key, value }]
}

/** Record deleting `key`; deleting a key that was only added here just drops that addition. */
export function deleteEnvChange(view, changes, key) {
  const rest = changes.filter(change => change.key !== key)
  return view.variables.some(variable => variable.key === key) ? [...rest, { key, delete: true }] : rest
}

/** Same checks as {@link validateEnvRow}, against a masked view plus pending changes. */
export function validateMaskedEnvRow(view, changes, { key, value }, originalKey) {
  const name = String(key ?? '').trim()
  if (!name) return 'key-required'
  if (!validKey.test(name)) return 'key-invalid'
  if (name !== originalKey && maskedEnvRows(view, changes).some(row => row.key === name)) return 'key-duplicate'
  const text = String(value ?? '')
  if (isEnvMaskPlaceholder(text)) return 'value-masked'
  const quote = /^["'`]/.test(text) ? text[0] : null
  if (quote) {
    // The closing quote must exist, with nothing after it on another line.
    let end = -1
    for (let i = 1; i < text.length && end < 0; i++) {
      if (text[i] !== quote) continue
      let escapes = 0
      for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) escapes++
      if (escapes % 2 === 0) end = i
    }
    if (end < 0 || /[\r\n]/.test(text.slice(end + 1))) return 'value-multiline'
  } else if (/[\r\n]/.test(text)) return 'value-multiline'
  return null
}

/**
 * After a per-key save: whether the view read back holds what was submitted — set keys present,
 * deleted keys gone. Values are never compared or shown.
 */
export function maskedEnvReadBackMismatch(changes, view) {
  const byKey = new Map(view.variables.map(variable => [variable.key, variable]))
  for (const change of changes) {
    const stored = byKey.get(change.key)
    if (change.delete) {
      if (stored) return { path: change.key, submitted: null, readBack: stored.masked, masked: true }
      continue
    }
    if (!stored) return { path: change.key, submitted: maskEnvDisplay(change.value), readBack: null, masked: true }
  }
  return null
}
