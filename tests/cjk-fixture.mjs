import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

const CJK = /[㐀-鿿]/

/** A literal is authored copy when it is the message argument of `*.t(...)` or `translate(locale, ...)`. */
function isTranslationArgument(node, source) {
  const call = node.parent
  if (!ts.isCallExpression(call)) return false
  const name = call.expression.getText(source)
  const index = name === 't' || name.endsWith('.t') ? 0 : name === 'translate' ? 1 : -1
  return index >= 0 && call.arguments[index] === node
}

/**
 * CJK text that would reach the screen untranslated: JSX text, and string/template literals
 * that are not handed to the i18n helper. Returns `line: text` entries.
 */
export function untranslatedCjk(file) {
  const text = readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found = []
  const report = node => found.push(`${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${node.getText(source).trim().slice(0, 60)}`)
  const visit = node => {
    if (ts.isJsxText(node)) { if (CJK.test(node.text)) report(node) }
    else if (ts.isStringLiteralLike(node)) { if (CJK.test(node.text) && !isTranslationArgument(node, source)) report(node) }
    else if (ts.isTemplateExpression(node)) { if (CJK.test(node.head.text) || node.templateSpans.some(span => CJK.test(span.literal.text))) report(node) }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

export function sourceFilesUnder(path) {
  if (!statSync(path).isDirectory()) return [path]
  return readdirSync(path).flatMap(name => sourceFilesUnder(join(path, name))).filter(file => /\.(?:tsx?|mjs)$/.test(file) && !/\.d\.mts$/.test(file))
}
