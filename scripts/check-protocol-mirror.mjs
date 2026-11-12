#!/usr/bin/env node
/**
 * Compares the hand-copied protocol constants (`console-ui/src/contracts/console-protocol-mirror.mjs`)
 * with the `@zhin.js/console-protocol` source in a zhinjs/zhin checkout.
 *
 *   node scripts/check-protocol-mirror.mjs [<protocol src dir> …]
 *
 * Without arguments it reads `ZHIN_PROTOCOL_SRC` (path list separated by the platform delimiter),
 * else the first existing of `../zhin-conv`, `../zhin` (relative to this repository) +
 * `packages/console/protocol/src`. Each `.ts` file is transpiled with TypeScript (no type check)
 * into a temporary directory and imported, so the comparison uses the real values.
 *
 * After `@zhin.js/console-protocol` is published and the mirror re-exports it, this script is no
 * longer needed: the mirror test then imports the package directly.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import ts from 'typescript'
import * as mirror from '../console-ui/src/contracts/console-protocol-mirror.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROTOCOL_SUBPATH = path.join('packages', 'console', 'protocol', 'src')

/** Protocol source directories to check, in order. */
export function defaultProtocolSources(env = process.env) {
  if (env.ZHIN_PROTOCOL_SRC) return env.ZHIN_PROTOCOL_SRC.split(path.delimiter).filter(Boolean)
  for (const checkout of ['zhin-conv', 'zhin']) {
    const dir = path.resolve(ROOT, '..', checkout, PROTOCOL_SUBPATH)
    if (existsSync(path.join(dir, 'index.ts'))) return [dir]
  }
  return []
}

/** Transpiles the protocol sources and imports the barrel (`index.ts`). */
export async function loadProtocolSource(dir) {
  const out = await mkdtemp(path.join(tmpdir(), 'zhin-protocol-'))
  try {
    await writeFile(path.join(out, 'package.json'), '{"type":"module"}')
    for (const name of await readdir(dir)) {
      if (!name.endsWith('.ts') || name.endsWith('.d.ts')) continue
      const source = await readFile(path.join(dir, name), 'utf8')
      const { outputText } = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
        fileName: name,
      })
      await writeFile(path.join(out, name.replace(/\.ts$/u, '.js')), outputText)
    }
    return await import(pathToFileURL(path.join(out, 'index.js')).href)
  } finally {
    await rm(out, { recursive: true, force: true })
  }
}

const asSorted = value => [...value].map(String).sort()
const describe = value => {
  const text = JSON.stringify(value instanceof Set ? [...value] : value)
  return text && text.length > 200 ? `${text.slice(0, 200)}…` : text
}

/** Result per mirrored name: `{ name, status: 'ok' | 'pending' | 'missing' | 'mismatch', detail? }`. */
export function compareMirror(upstream, local = mirror) {
  const results = []
  for (const [name, rule] of Object.entries(local.MIRROR_COMPARISON)) {
    const mode = typeof rule === 'string' ? rule : rule.compare
    const upstreamName = typeof rule === 'string' ? name : rule.upstream
    const ours = local[name]
    const theirs = upstream[upstreamName]
    if (theirs === undefined) {
      results.push(local.PENDING_UPSTREAM.includes(name)
        ? { name, status: 'pending', detail: `${upstreamName} is not in this protocol source yet` }
        : { name, status: 'missing', detail: `${upstreamName} is not exported by the protocol source` })
      continue
    }
    let problem = null
    if (mode === 'equal') {
      if (!isDeepStrictEqual(JSON.parse(JSON.stringify(ours)), JSON.parse(JSON.stringify(theirs)))) {
        problem = `console ${describe(ours)} ≠ protocol ${describe(theirs)}`
      }
    } else if (mode === 'set') {
      const a = asSorted(ours), b = asSorted(theirs instanceof Set ? theirs : theirs)
      if (!isDeepStrictEqual(a, b)) problem = `console ${describe(a)} ≠ protocol ${describe(b)}`
    } else if (mode === 'subset') {
      const wrong = Object.entries(ours).filter(([key, value]) => theirs[key] !== value)
      if (wrong.length) problem = wrong.map(([key, value]) => `${key}: console ${value} ≠ protocol ${theirs[key] ?? '(absent)'}`).join('; ')
    } else if (mode === 'http-rules') {
      const wrong = ours.filter(rule => !theirs.some(other => other.method === rule.method && other.path === rule.path && other.permission === rule.permission))
      if (wrong.length) problem = wrong.map(rule => `${rule.method} ${rule.path} (${rule.permission})`).join('; ') + ' not in protocol'
    } else {
      problem = `unknown comparison ${mode}`
    }
    results.push(problem ? { name, status: 'mismatch', detail: problem } : { name, status: 'ok' })
  }
  return results
}

export async function checkProtocolMirror(dir) {
  const upstream = await loadProtocolSource(dir)
  const results = compareMirror(upstream)
  return { dir, results, ok: results.every(result => result.status === 'ok' || result.status === 'pending') }
}

async function main(argv) {
  const dirs = argv.length ? argv : defaultProtocolSources()
  if (!dirs.length) {
    console.error('No @zhin.js/console-protocol source found. Pass a path or set ZHIN_PROTOCOL_SRC.')
    return 2
  }
  let failed = false
  for (const dir of dirs) {
    const { results, ok } = await checkProtocolMirror(dir)
    console.log(`\n${dir}`)
    for (const result of results) {
      const mark = result.status === 'ok' ? 'ok     ' : result.status === 'pending' ? 'pending' : 'FAIL   '
      console.log(`  ${mark} ${result.name}${result.detail ? ` — ${result.detail}` : ''}`)
    }
    failed ||= !ok
  }
  return failed ? 1 : 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2))
}
