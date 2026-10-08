import { masonryLayout } from './masonry-layout.mjs'
import { GalleryPreview } from './GalleryPreview'
import { JsonViewer } from './JsonViewer'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Bot,
  Boxes,
  CheckCircle2,
  CircleDot,
  FileCode2,
  GitBranch,
  Network,
  PlugZap,
  Server,
  ShieldCheck,
  ScrollText,
  Terminal,
  Unplug,
  Wrench,
} from 'lucide-react'
import { cn } from '@zhin.js/client'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import { capabilityEmptyState } from './empty-state.mjs'
import type { CapabilityItem, CapabilityRowMap, IntrospectionTab } from './capability-model'

interface CapabilityExplorerProps<K extends IntrospectionTab> {
  kind: K
  items: CapabilityRowMap[K][]
  readOnly: boolean
  filter?: string
  total?: number
  onClearFilter?(): void
}

const KIND_META: Record<IntrospectionTab, {
  eyebrow: string
  title: string
  description: string
  icon: typeof Terminal
}> = {
  commands: {
    eyebrow: 'Command catalog',
    title: '命令目录',
    description: '按用户入口理解命令路由、参数契约与权限边界。',
    icon: Terminal,
  },
  middlewares: {
    eyebrow: 'Runtime pipeline',
    title: '执行管线',
    description: '按照 Phase 与 Order 查看请求穿过 Runtime 的真实顺序。',
    icon: GitBranch,
  },
  components: {
    eyebrow: '组件',
    title: '组件画廊',
    description: '查看组件并预览效果。',
    icon: Boxes,
  },
  endpoints: {
    eyebrow: 'Adapter runtime',
    title: 'Endpoint 状态',
    description: '从适配器视角检查当前连接与运行状态。',
    icon: Bot,
  },
  bindings: {
    eyebrow: 'Agent topology',
    title: 'Agent 关系',
    description: '理解 Agent、模型 Provider、MCP Server 与 Agent File 的组合。',
    icon: Network,
  },
  tools: {
    eyebrow: 'Tool registry',
    title: '工具目录',
    description: '检查 Agent 可发现的工具、职责说明与注册来源。',
    icon: Wrench,
  },
  'prompt-sections': {
    eyebrow: 'Prompt governance',
    title: '提示词片段',
    description: '查看提示词片段的来源与适用范围。',
    icon: ScrollText,
  },
  mcp: {
    eyebrow: 'MCP connections',
    title: 'MCP 服务',
    description: '观察外部能力服务的连接健康度与工具供给。',
    icon: Server,
  },
}

function text(value: unknown, fallback = '—'): string {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number') return String(value)
  return fallback
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => typeof entry === 'string' ? entry : JSON.stringify(entry))
}

function identity(item: CapabilityItem, index: number): string {
  return `${text(item.name, text(item.pattern, 'item'))}:${text(item.owner, text(item.plugin, 'runtime'))}:${index}`
}

function itemTitle(kind: IntrospectionTab, item: CapabilityItem): string {
  if (kind === 'commands') return text(item.pattern, '未命名命令')
  return text(item.name, '未命名能力')
}

export function CapabilityExplorer<K extends IntrospectionTab>({ kind, items, readOnly, filter, total, onClearFilter }: CapabilityExplorerProps<K>) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const indexedItems = useMemo(() => items.map((item, index) => ({ kind, item, id: identity(item, index) })), [items, kind])
  const selected = indexedItems.find(({ id }) => id === selectedId)?.item ?? indexedItems[0]?.item ?? null
  const meta = KIND_META[kind]
  const Icon = meta.icon

  useEffect(() => {
    setSelectedId(indexedItems[0]?.id ?? null)
    setDetailsOpen(false)
  }, [indexedItems, kind])

  if (!items.length) {
    const empty = capabilityEmptyState({ title: kind === 'components' ? '组件' : meta.title, filter, total })
    return (
      <div className="console-runtime-empty">
        <Icon aria-hidden="true" />
        <div>
          <strong>{empty.title}</strong>
          <p>{empty.description}</p>
          {empty.clearFilter && onClearFilter ? <Button variant="outline" size="sm" className="mt-3" onClick={onClearFilter}>清除筛选</Button> : null}
        </div>
      </div>
    )
  }

  return (
    <section className="console-capability-explorer" aria-labelledby="capability-collection-title">
      <header className="console-capability-intro">
        <div className="console-capability-intro-icon"><Icon aria-hidden="true" /></div>
        <div>
          {kind !== 'components' ? <span className="console-eyebrow">{meta.eyebrow}</span> : null}
          <h2 id="capability-collection-title">{meta.title}</h2>
          {kind !== 'components' ? <p>{meta.description}</p> : null}
        </div>
        <div className="console-capability-count"><strong>{items.length}</strong><span>{kind === 'components' ? '个组件' : '项'}</span></div>
      </header>

      <div className={cn("console-capability-workspace", kind === 'components' && "console-component-gallery-workspace")}>
        <div className="console-capability-collection">
          {kind === 'commands' ? (
            <CommandCatalog entries={entriesForKind(indexedItems, 'commands')} selectedId={selectedId} onSelect={setSelectedId} />
          ) : kind === 'middlewares' ? (
            <MiddlewarePipeline entries={entriesForKind(indexedItems, 'middlewares')} selectedId={selectedId} onSelect={setSelectedId} />
          ) : kind === 'components' ? (
            <ComponentGallery entries={entriesForKind(indexedItems, 'components')} selectedId={selectedId} readOnly={readOnly} onSelect={(id) => { setSelectedId(id); setDetailsOpen(true) }} />
          ) : kind === 'endpoints' ? (
            <EndpointGrid entries={entriesForKind(indexedItems, 'endpoints')} selectedId={selectedId} onSelect={setSelectedId} />
          ) : kind === 'bindings' ? (
            <BindingMap entries={entriesForKind(indexedItems, 'bindings')} selectedId={selectedId} onSelect={setSelectedId} />
          ) : kind === 'tools' ? (
            <ToolCatalog entries={entriesForKind(indexedItems, 'tools')} selectedId={selectedId} onSelect={setSelectedId} />
          ) : kind === 'prompt-sections' ? (
            <PromptSectionCatalog entries={entriesForKind(indexedItems, 'prompt-sections')} selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <McpGrid entries={entriesForKind(indexedItems, 'mcp')} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </div>
        {kind === 'components' ? <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent className="console-component-drawer" aria-describedby={undefined} onCloseAutoFocus={(event) => {
            event.preventDefault()
            document.getElementById(`component-card-${selectedId}`)?.focus()
          }}>
            <DialogTitle className="sr-only">组件详情</DialogTitle>
            <CapabilityInspector kind={kind} item={selected} readOnly={readOnly} />
          </DialogContent>
        </Dialog> : <CapabilityInspector kind={kind} item={selected} readOnly={readOnly} />}
      </div>
    </section>
  )
}

type Entry<K extends IntrospectionTab> = { kind: K; item: CapabilityRowMap[K]; id: string }
type AnyEntry = { kind: IntrospectionTab; item: CapabilityItem; id: string }
type CollectionProps<K extends IntrospectionTab> = { entries: Entry<K>[]; selectedId: string | null; onSelect(id: string): void }

function entriesForKind<K extends IntrospectionTab>(entries: readonly AnyEntry[], kind: K): Entry<K>[] {
  // The runtime tag is added alongside each row above; this is the sole union narrowing boundary.
  return entries.filter((entry) => entry.kind === kind) as Entry<K>[]
}

function SelectableCard<K extends IntrospectionTab>(props: CollectionProps<K> & { entry: Entry<K>; children: ReactNode; className?: string }) {
  const selected = props.entry.id === props.selectedId
  return (
    <button
      type="button"
      className={cn('console-runtime-card', selected && 'is-selected', props.className)}
      aria-pressed={selected}
      onClick={() => props.onSelect(props.entry.id)}
    >
      {props.children}
    </button>
  )
}

function CommandCatalog({ entries, selectedId, onSelect }: CollectionProps<'commands'>) {
  return (
    <div className="console-runtime-command-list" aria-label="命令目录">
      {entries.map((entry) => {
        const parameters = list(entry.item.parameters)
        const permissions = list(entry.item.permissions)
        return (
          <SelectableCard key={entry.id} {...{ entry, entries, selectedId, onSelect }}>
            <span className="console-runtime-card-icon"><Terminal /></span>
            <span className="console-runtime-card-main">
              <strong className="font-mono">{text(entry.item.pattern, '未命名命令')}</strong>
              <small>{text(entry.item.desc, '没有提供命令说明')}</small>
              <span className="console-runtime-tags">
                {parameters.length ? <Badge variant="outline">{parameters.length} 参数</Badge> : <Badge variant="secondary">无参数</Badge>}
                {permissions.length ? <Badge variant="warning"><ShieldCheck />{permissions.length} 权限</Badge> : null}
              </span>
            </span>
            <span className="console-runtime-source">{text(entry.item.plugin, 'runtime')}<ArrowRight /></span>
          </SelectableCard>
        )
      })}
    </div>
  )
}

function MiddlewarePipeline({ entries, selectedId, onSelect }: CollectionProps<'middlewares'>) {
  const phases = new Map<string, Entry<'middlewares'>[]>()
  // Host's MiddlewareIndex is the execution-order SSOT: phase → order → topology → id.
  // Preserve that projection order; regrouping must never invent a different pipeline.
  for (const entry of entries) {
    const phase = text(entry.item.phase, 'unphased')
    phases.set(phase, [...(phases.get(phase) ?? []), entry])
  }
  let sequence = 0
  return (
    <div className="console-runtime-pipeline" aria-label="中间件执行管线">
      {[...phases].map(([phase, phaseEntries]) => (
        <section key={phase} className="console-runtime-phase">
          <header><span>{phase}</span><small>{phaseEntries.length} stages</small></header>
          <div>
            {phaseEntries.map((entry) => {
              sequence += 1
              return (
                <SelectableCard key={entry.id} {...{ entry, entries, selectedId, onSelect }} className="console-runtime-stage">
                  <span className="console-runtime-sequence">{String(sequence).padStart(2, '0')}</span>
                  <span className="console-runtime-card-main">
                    <strong>{text(entry.item.name, 'unnamed middleware')}</strong>
                    <small>{text(entry.item.target, 'global target')} · order {text(entry.item.order, 'auto')}</small>
                  </span>
                  <Badge variant="outline">{text(entry.item.owner, 'runtime')}</Badge>
                </SelectableCard>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function ComponentGallery(props: CollectionProps<'components'> & { readOnly: boolean }) {
  const container = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState(() => masonryLayout(0, []))
  useEffect(() => {
    const root = container.current
    if (!root) return
    let frame = 0
    function measure() {
      if (!root) return
      const heights = [...root.querySelectorAll<HTMLElement>(':scope > article')].map(card => card.getBoundingClientRect().height)
      const parent = root.parentElement
      const padding = parent ? getComputedStyle(parent) : null
      const available = (parent?.clientWidth ?? root.clientWidth) - parseFloat(padding?.paddingLeft ?? '0') - parseFloat(padding?.paddingRight ?? '0')
      const next = masonryLayout(available, heights)
      setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    })
    observer.observe(root.parentElement ?? root)
    for (const card of root.children) observer.observe(card)
    measure()
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [props.entries])
  return (
    <div ref={container} className="console-component-masonry" aria-label="组件画廊" style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, maxWidth: layout.maxWidth }}>
      {props.entries.map((entry, index) => <ComponentGalleryCard key={entry.id} entry={entry} position={layout.items[index]} selected={entry.id === props.selectedId} readOnly={props.readOnly} onSelect={() => props.onSelect(entry.id)} />)}
    </div>
  )
}

function ComponentGalleryCard({ entry, position, selected, readOnly, onSelect }: { entry: Entry<'components'>; position?: { column: number; row: number; span: number }; selected: boolean; readOnly: boolean; onSelect(): void }) {
  return <article className={cn('console-runtime-component', selected && 'is-selected')} style={position ? { gridColumn: position.column, gridRow: `${position.row} / span ${position.span}` } : undefined} onClick={(event) => {
    if ((event.target as Element).closest('button,a,input,textarea,summary')) return
    onSelect()
  }}>
    <GalleryPreview item={entry.item} readOnly={readOnly} />
    <button id={`component-card-${entry.id}`} type="button" aria-label={`查看 ${text(entry.item.name)} 组件详情`} aria-pressed={selected} onClick={onSelect}>
      <strong>{text(entry.item.name, '未命名组件')}</strong><small>{text(entry.item.owner, 'runtime')}</small>
    </button>
  </article>
}

function EndpointGrid({ entries, selectedId, onSelect }: CollectionProps<'endpoints'>) {
  return (
    <div className="console-runtime-card-grid" aria-label="Endpoint 状态">
      {entries.map((entry) => {
        const online = entry.item.online === true
        return (
          <SelectableCard key={entry.id} {...{ entry, entries, selectedId, onSelect }} className="console-runtime-health-card">
            <span className={cn('console-runtime-health', online && 'is-online')}>{online ? <CheckCircle2 /> : <Unplug />}</span>
            <span className="console-runtime-card-main">
              <small>{text(entry.item.adapter, 'adapter')}</small>
              <strong>{text(entry.item.name, '未命名 Endpoint')}</strong>
              <span>{text(entry.item.status, online ? 'connected' : 'offline')}</span>
            </span>
          </SelectableCard>
        )
      })}
    </div>
  )
}

function BindingMap({ entries, selectedId, onSelect }: CollectionProps<'bindings'>) {
  return (
    <div className="console-runtime-binding-list" aria-label="Agent 关系">
      {entries.map((entry) => {
        const servers = list(entry.item.mcpServers)
        return (
          <SelectableCard key={entry.id} {...{ entry, entries, selectedId, onSelect }} className="console-runtime-binding">
            <span className="console-runtime-node is-agent"><Bot /></span>
            <span className="console-runtime-card-main console-runtime-binding-agent"><small>Agent</small><strong>{text(entry.item.name)}</strong></span>
            <span className="console-runtime-edge"><ArrowRight /></span>
            <span className="console-runtime-node"><CircleDot /></span>
            <span className="console-runtime-card-main console-runtime-binding-provider"><small>{text(entry.item.provider, 'Provider')}</small><strong>{text(entry.item.model, '默认模型')}</strong></span>
            <span className="console-runtime-binding-meta">
              <Badge variant={servers.length ? 'success' : 'secondary'}>{servers.length} MCP</Badge>
              {entry.item.hasAgentFile === true ? <Badge variant="outline"><FileCode2 />agent.md</Badge> : null}
            </span>
          </SelectableCard>
        )
      })}
    </div>
  )
}

function ToolCatalog({ entries, selectedId, onSelect }: CollectionProps<'tools'>) {
  return (
    <div className="console-runtime-card-grid" aria-label="工具目录">
      {entries.map((entry) => (
        <SelectableCard key={entry.id} {...{ entry, entries, selectedId, onSelect }} className="console-runtime-tool-card">
          <span className="console-runtime-card-icon"><Wrench /></span>
          <span className="console-runtime-card-main">
            <strong>{text(entry.item.name, '未命名工具')}</strong>
            <small>{text(entry.item.description, '没有提供工具说明')}</small>
          </span>
          <Badge variant="outline">{text(entry.item.source, 'runtime')}</Badge>
        </SelectableCard>
      ))}
    </div>
  )
}

function PromptSectionCatalog({ entries, selectedId, onSelect }: CollectionProps<'prompt-sections'>) {
  return (
    <div className="console-runtime-prompt-list" aria-label="提示词片段目录">
      {entries.map((entry) => {
        const profiles = list(entry.item.profiles)
        const platforms = list(entry.item.platforms)
        const retention = text(entry.item.retention, 'preferred')
        const contentChars = text(entry.item.contentChars, '0')
        const maxChars = entry.item.maxChars == null ? '未限制' : `${text(entry.item.maxChars)} 上限`
        return (
          <SelectableCard key={entry.id} {...{ entry, entries, selectedId, onSelect }} className="console-runtime-prompt-card">
            <span className="console-runtime-card-icon"><ScrollText /></span>
            <span className="console-runtime-card-main">
              <span className="console-runtime-prompt-heading">
                <strong>{text(entry.item.title, text(entry.item.name, '未命名片段'))}</strong>
                <Badge variant={retention === 'required' ? 'warning' : retention === 'preferred' ? 'secondary' : 'outline'}>{retention}</Badge>
              </span>
              <small>{text(entry.item.owner, 'runtime')} · {text(entry.item.layer, 'context')} · order {text(entry.item.order, '50')}</small>
              <span className="console-runtime-tags">
                {profiles.map((profile) => <Badge key={profile} variant="outline">{profile}</Badge>)}
                {platforms.map((platform) => <Badge key={platform} variant="secondary">{platform}</Badge>)}
                {!platforms.length ? <Badge variant="secondary">全平台</Badge> : null}
              </span>
            </span>
            <span className="console-runtime-prompt-budget">
              <strong>{contentChars}</strong>
              <small>chars · {maxChars}</small>
              <span>gen {text(entry.item.generation, '—')}</span>
            </span>
          </SelectableCard>
        )
      })}
    </div>
  )
}

function McpGrid({ entries, selectedId, onSelect }: CollectionProps<'mcp'>) {
  return (
    <div className="console-runtime-card-grid" aria-label="MCP 服务">
      {entries.map((entry) => {
        const connected = entry.item.connected === true
        return (
          <SelectableCard key={entry.id} {...{ entry, entries, selectedId, onSelect }} className="console-runtime-mcp-card">
            <span className={cn('console-runtime-health', connected && 'is-online')}>{connected ? <PlugZap /> : <Unplug />}</span>
            <span className="console-runtime-card-main">
              <strong>{text(entry.item.name, '未命名 MCP')}</strong>
              <small>{connected ? `${text(entry.item.toolCount, '0')} tools available` : text(entry.item.error, '连接不可用')}</small>
            </span>
            <Badge variant={connected ? 'success' : 'destructive'}>{connected ? 'Connected' : 'Offline'}</Badge>
          </SelectableCard>
        )
      })}
    </div>
  )
}

const PROPERTY_LABELS: Record<string, string> = {
  name: '名称', pattern: '命令', desc: '说明', description: '说明',
  owner: '所属插件', plugin: '所属插件', source: '来源文件',
  parameters: '参数', aliases: '别名', permissions: '权限',
  phase: '阶段', target: '目标', order: '顺序', adapter: '适配器',
  online: '在线', status: '状态', provider: '模型提供方', model: '模型',
  mcpServers: 'MCP 服务', hasAgentFile: 'Agent 文件',
  qualifiedName: '完整名称', title: '标题', layer: '层级',
  retention: '保留策略', maxChars: '字符上限', profiles: '适用配置',
  platforms: '适用平台', generation: '运行代', contentChars: '内容字符数',
  connected: '已连接', toolCount: '工具数', error: '错误',
}

function CapabilityInspector(props: {
  kind: IntrospectionTab
  item: CapabilityItem | null
  readOnly: boolean
}) {
  const { item, kind } = props
  if (!item) return null
  const details = Object.entries(item).filter(([key, value]) => key !== 'previewProps' && value != null && value !== '')
  return (
    <aside className="console-capability-inspector" aria-label="能力详情">
      <header>
        <span className="console-eyebrow">{kind === 'components' ? '组件详情' : '能力详情'}</span>
        <h3>{itemTitle(kind, item)}</h3>

      </header>
      <div className="console-capability-inspector-actions">
        {kind === 'bindings' ? (
          <Button asChild size="sm"><Link to="/agent/workbench">进入 Agent 工作台<ArrowRight /></Link></Button>
        ) : null}
        {kind === 'endpoints' ? (
          <Button asChild size="sm"><Link to="/endpoints">管理 Endpoints<ArrowRight /></Link></Button>
        ) : null}
      </div>
      <dl className="console-capability-properties">
        {details.slice(0, 8).map(([key, value]) => (
          <div key={key}><dt>{PROPERTY_LABELS[key] ?? key}</dt><dd>{formatValue(value)}</dd></div>
        ))}
      </dl>
      {Object.prototype.hasOwnProperty.call(item, 'previewProps') ? <details className="console-capability-raw"><summary>示例参数</summary><JsonViewer value={item.previewProps} /></details> : null}
      <details className="console-capability-raw">
        <summary>原始数据</summary>
        <JsonViewer value={item} />
      </details>
    </aside>
  )
}

function formatValue(value: unknown): ReactNode {
  if (typeof value === 'boolean') return <Badge variant={value ? 'success' : 'secondary'}>{value ? '是' : '否'}</Badge>
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">—</span>
    return <span className="console-runtime-tags">{value.map((entry, index) => <Badge key={`${String(entry)}-${index}`} variant="outline">{typeof entry === 'object' ? JSON.stringify(entry) : String(entry)}</Badge>)}</span>
  }
  if (typeof value === 'object') return <code>{JSON.stringify(value)}</code>
  return String(value)
}
