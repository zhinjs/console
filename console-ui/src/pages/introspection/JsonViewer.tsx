import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { highlightCode } from '../files/highlight-code.mjs'
import '../files/code-highlight.css'
import './json-viewer.css'
import { copyJson } from './preview-parameters.mjs'

function JsonNode({ value, name, root = false }: { value: unknown; name?: string; root?: boolean }) {
  const complex = value !== null && typeof value === 'object'
  const key = name === undefined ? null : <span className="json-key">{JSON.stringify(name)}: </span>
  if (!complex) return <div className="json-leaf">{key}<span className={`json-${value === null ? 'null' : typeof value}`}>{JSON.stringify(value) ?? String(value)}</span></div>
  const entries = Object.entries(value as Record<string, unknown>)
  return <details open={root || undefined} className="json-node"><summary>{key}<span className="json-type">{Array.isArray(value) ? '数组' : '对象'} · {entries.length} 项</span></summary><div className="json-children">{entries.map(([key, child]) => <JsonNode key={key} name={key} value={child} />)}</div></details>
}

export function JsonViewer({ value }: { value: unknown }) {
  const source = JSON.stringify(value, null, 2) ?? String(value)
  // Copy feedback and disclosure state belong to this exact value. A late copy
  // from an unmounted value must not report success for a different selection.
  return <JsonViewerContent key={source} value={value} source={source} />
}

function JsonViewerContent({ value, source }: { value: unknown; source: string }) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  async function copy() {
    setCopied(false); setError('')
    try { await copyJson(value, navigator.clipboard); setCopied(true) }
    catch { setError('复制失败，请展开 JSON 原文后手动复制。') }
  }
  return <div className="console-json-viewer"><div className="json-toolbar"><span>JSON 数据</span><Button size="sm" variant="outline" onClick={() => void copy()}>{copied ? '已复制' : '复制 JSON'}</Button></div>{error ? <p role="alert">{error}</p> : null}<JsonNode value={value} root /><details className="json-source"><summary>查看 JSON 原文</summary><pre><code className="hljs language-json" dangerouslySetInnerHTML={{ __html: highlightCode(source, 'json') }} /></pre></details></div>
}
