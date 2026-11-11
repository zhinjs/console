import { translate } from '../../i18n/locale.mjs'
import { useI18n } from '../../i18n'
import { masonryLayout } from './masonry-layout.mjs'
import { permissionLinkFor } from '../permission-link-model.mjs'
import { GalleryPreview } from './GalleryPreview'
import { JsonViewer } from './JsonViewer'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Bot,
  Boxes,
  Check,
  CheckCircle2,
  CircleDot,
  Copy,
  FileCode2,
  GitBranch,
  Loader2,
  MessageSquare,
  Network,
  Play,
  PlugZap,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  ScrollText,
  Terminal,
  Unplug,
  Wrench,
} from 'lucide-react'
import { cn } from '@zhin.js/client'
import { ENDPOINT_RPC } from '../../contracts/zhin-console'
import { requestConsole } from '../../utils/console-rpc'
import { useInboxCacheScope } from '../../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../../utils/inbox-cache'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '../../components/ui/dialog'
import { Input } from '../../components/ui/input'
import { SelectField } from '../../components/ui/select'
import { capabilityEmptyState } from './empty-state.mjs'
import { readPreviewEndpoints, type PreviewEndpoint } from './target-preview.mjs'
import type { CapabilityItem, CapabilityRowMap, IntrospectionTab } from './capability-model'
import { ListItemButton } from '../../components/ui/list-item-button'
import './component-gallery.css'

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

function itemOwner(item: CapabilityItem): string {
  for (const candidate of [item.owner, item.plugin, item.source, item.adapter, item.provider]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return ''
}

function extractCommandTrigger(item: CapabilityItem, stripParams = false): string {
  const usageList = Array.isArray(item.usage) ? item.usage : []
  const firstUsage = typeof usageList[0] === 'string' && usageList[0].trim() ? usageList[0].trim() : ''
  const raw = firstUsage || (typeof item.pattern === 'string' && item.pattern.trim() ? item.pattern.trim() : text(item.name, ''))
  if (!stripParams) return raw
  const cleaned = raw.replace(/\s+[<\[].*$/, '').trim()
  return cleaned || raw
}

function identity(item: CapabilityItem, index: number): string {
  return `${text(item.name, text(item.pattern, 'item'))}:${text(item.owner, text(item.plugin, 'runtime'))}:${index}`
}

function itemTitle(kind: IntrospectionTab, item: CapabilityItem, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  if (kind === 'commands') return text(item.pattern, translate(locale, "未命名命令"))
  return text(item.name, translate(locale, "未命名能力"))
}

export function CapabilityExplorer<K extends IntrospectionTab>({ kind, items, readOnly, filter, total, onClearFilter }: CapabilityExplorerProps<K>) {
  const i18n = useI18n()
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [ownerFilter, setOwnerFilter] = useState<string>('')
  const indexedItems = useMemo(() => items.map((item, index) => ({ kind, item, id: identity(item, index) })), [items, kind])

  const ownerGroups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const { item } of indexedItems) {
      const owner = itemOwner(item)
      if (!owner) continue
      counts.set(owner, (counts.get(owner) ?? 0) + 1)
    }
    return [...counts.entries()].map(([owner, count]) => ({ owner, count }))
  }, [indexedItems])

  const visibleItems = useMemo(() => {
    if (!ownerFilter) return indexedItems
    return indexedItems.filter(({ item }) => itemOwner(item) === ownerFilter)
  }, [indexedItems, ownerFilter])

  const selected = visibleItems.find(({ id }) => id === selectedId)?.item ?? visibleItems[0]?.item ?? null
  const authoredMeta = KIND_META[kind]
  const meta = { ...authoredMeta, title: i18n.t(authoredMeta.title), description: i18n.t(authoredMeta.description), eyebrow: i18n.t(authoredMeta.eyebrow) }
  const Icon = meta.icon

  useEffect(() => {
    setOwnerFilter('')
  }, [kind])

  useEffect(() => {
    if (ownerFilter && !ownerGroups.some((group) => group.owner === ownerFilter)) {
      setOwnerFilter('')
    }
  }, [ownerFilter, ownerGroups])

  useEffect(() => {
    setSelectedId(visibleItems[0]?.id ?? null)
    setDetailsOpen(false)
  }, [visibleItems, kind])

  if (!items.length) {
    const empty = capabilityEmptyState({ title: kind === 'components' ? i18n.t("组件") : meta.title, filter, total }, i18n.locale)
    return (
      <div className="console-runtime-empty">
        <Icon aria-hidden="true" />
        <div>
          <strong>{empty.title}</strong>
          <p>{empty.description}</p>
          {empty.clearFilter && onClearFilter ? <Button variant="outline" size="sm" className="mt-3" onClick={onClearFilter}>{i18n.t("清除筛选")}</Button> : null}
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
        <div className="console-capability-count"><strong>{visibleItems.length}</strong><span>{kind === 'components' ? i18n.t("个组件") : i18n.t("项")}</span></div>
        {kind === 'commands' && <Button asChild size="sm" variant="outline"><Link to="/permissions"><ShieldCheck className="size-4 mr-2" />{i18n.t("查看权限说明")}</Link></Button>}
      </header>

      {ownerGroups.length > 1 ? (
        <div className="console-capability-owner-bar" role="group" aria-label={i18n.t("按所属插件筛选")}>
          <button
            type="button"
            className={cn('console-capability-owner-pill', !ownerFilter && 'is-active')}
            aria-pressed={!ownerFilter}
            onClick={() => setOwnerFilter('')}
          >
            <span>{i18n.t("全部")}</span>
            <span className="console-capability-owner-count">{indexedItems.length}</span>
          </button>
          {ownerGroups.map(({ owner, count }) => {
            const active = ownerFilter === owner
            return (
              <button
                key={owner}
                type="button"
                className={cn('console-capability-owner-pill', active && 'is-active')}
                aria-pressed={active}
                onClick={() => setOwnerFilter(active ? '' : owner)}
              >
                <span>{owner}</span>
                <span className="console-capability-owner-count">{count}</span>
              </button>
            )
          })}
        </div>
      ) : null}

      <div className={cn("console-capability-workspace", kind === 'components' && "console-component-gallery-workspace")}>
        <div className="console-capability-collection">
          {kind === 'commands' ? (
            <CommandCatalog entries={entriesForKind(visibleItems, 'commands')} selectedId={selectedId} onSelect={setSelectedId} />
          ) : kind === 'middlewares' ? (
            <MiddlewarePipeline entries={entriesForKind(visibleItems, 'middlewares')} selectedId={selectedId} onSelect={setSelectedId} />
          ) : kind === 'components' ? (
            <ComponentGallery entries={entriesForKind(visibleItems, 'components')} selectedId={selectedId} readOnly={readOnly} onSelect={(id) => { setSelectedId(id); setDetailsOpen(true) }} />
          ) : kind === 'endpoints' ? (
            <EndpointGrid entries={entriesForKind(visibleItems, 'endpoints')} selectedId={selectedId} onSelect={setSelectedId} />
          ) : kind === 'bindings' ? (
            <BindingMap entries={entriesForKind(visibleItems, 'bindings')} selectedId={selectedId} onSelect={setSelectedId} />
          ) : kind === 'tools' ? (
            <ToolCatalog entries={entriesForKind(visibleItems, 'tools')} selectedId={selectedId} onSelect={setSelectedId} />
          ) : kind === 'prompt-sections' ? (
            <PromptSectionCatalog entries={entriesForKind(visibleItems, 'prompt-sections')} selectedId={selectedId} onSelect={setSelectedId} />
          ) : (
            <McpGrid entries={entriesForKind(visibleItems, 'mcp')} selectedId={selectedId} onSelect={setSelectedId} />
          )}
        </div>
        {kind === 'components' ? <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
          <DialogContent className="console-component-drawer" aria-describedby={undefined} onCloseAutoFocus={(event) => {
            event.preventDefault()
            document.getElementById(`component-card-${selectedId}`)?.focus()
          }}>
            <DialogTitle className="sr-only">{i18n.t("组件详情")}</DialogTitle>
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
    <ListItemButton
      type="button"
      className={cn('console-runtime-card', selected && 'is-selected', props.className)}
      aria-pressed={selected}
      onClick={() => props.onSelect(props.entry.id)}
    >
      {props.children}
    </ListItemButton>
  )
}

function CommandCatalog({ entries, selectedId, onSelect }: CollectionProps<'commands'>) {
  const i18n = useI18n()
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function copyCommand(id: string, item: CapabilityRowMap['commands']) {
    const commandText = extractCommandTrigger(item, false)
    if (!commandText) return
    try {
      await navigator.clipboard?.writeText(commandText)
      setCopiedId(id)
      setTimeout(() => setCopiedId((current) => current === id ? null : current), 1800)
    } catch {
      // Clipboard may be unavailable in restricted contexts
    }
  }

  return (
    <div className="console-runtime-command-list" aria-label={i18n.t("命令目录")}>
      {entries.map((entry) => {
        const parameters = list(entry.item.parameters)
        const permissions = list(entry.item.permissions)
        const copied = copiedId === entry.id
        const selected = entry.id === selectedId
        return (
          <div key={entry.id} className={cn('console-runtime-command-shell', selected && 'is-selected')}>
            <SelectableCard {...{ entry, entries, selectedId, onSelect }}>
              <span className="console-runtime-card-icon"><Terminal /></span>
              <span className="console-runtime-card-main">
                <strong className="font-mono">{text(entry.item.pattern, i18n.t("未命名命令"))}</strong>
                <small>{text(entry.item.desc, i18n.t("没有提供命令说明"))}</small>
                <span className="console-runtime-tags">
                  {parameters.length ? <Badge variant="outline">{parameters.length} {i18n.t(" 参数")}</Badge> : <Badge variant="secondary">{i18n.t("无参数")}</Badge>}
                  {permissions.length ? <Badge variant="warning"><ShieldCheck />{permissions.length} {i18n.t(" 权限")}</Badge> : null}
                </span>
                <span className="console-runtime-source"><span>{text(entry.item.plugin, 'runtime')}</span><ArrowRight /></span>
              </span>
            </SelectableCard>
            <button
              type="button"
              className="console-capability-copy-pill"
              aria-label={i18n.t("复制命令")}
              onClick={() => void copyCommand(entry.id, entry.item)}
            >
              {copied ? <Check /> : <Copy />}
              <span>{copied ? i18n.t("已复制") : i18n.t("复制命令")}</span>
            </button>
          </div>
        )
      })}
    </div>
  )
}

function MiddlewarePipeline({ entries, selectedId, onSelect }: CollectionProps<'middlewares'>) {
  const i18n = useI18n()
  const phases = new Map<string, Entry<'middlewares'>[]>()
  // Host's MiddlewareIndex is the execution-order SSOT: phase → order → topology → id.
  // Preserve that projection order; regrouping must never invent a different pipeline.
  for (const entry of entries) {
    const phase = text(entry.item.phase, i18n.t("未分组阶段"))
    phases.set(phase, [...(phases.get(phase) ?? []), entry])
  }
  let sequence = 0
  return (
    <div className="console-runtime-pipeline" aria-label={i18n.t("中间件执行管线")}>
      {[...phases].map(([phase, phaseEntries]) => (
        <section key={phase} className="console-runtime-phase">
          <header><span>{phase}</span><small>{i18n.t("{0} 个阶段", [phaseEntries.length])}</small></header>
          <div>
            {phaseEntries.map((entry) => {
              sequence += 1
              return (
                <SelectableCard key={entry.id} {...{ entry, entries, selectedId, onSelect }} className="console-runtime-stage">
                  <span className="console-runtime-sequence">{String(sequence).padStart(2, '0')}</span>
                  <span className="console-runtime-card-main">
                    <strong>{text(entry.item.name, i18n.t("未命名中间件"))}</strong>
                    <small>{text(entry.item.target, i18n.t("全局目标"))} · {i18n.t("顺序")} {text(entry.item.order, i18n.t("自动"))}</small>
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
  const i18n = useI18n()
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
    <div ref={container} className="console-component-masonry" aria-label={i18n.t("组件画廊")} style={{ gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, maxWidth: layout.maxWidth }}>
      {props.entries.map((entry, index) => <ComponentGalleryCard key={entry.id} entry={entry} position={layout.items[index]} selected={entry.id === props.selectedId} readOnly={props.readOnly} onSelect={() => props.onSelect(entry.id)} />)}
    </div>
  )
}

function ComponentGalleryCard({ entry, position, selected, readOnly, onSelect }: { entry: Entry<'components'>; position?: { column: number; row: number; span: number }; selected: boolean; readOnly: boolean; onSelect(): void }) {
  const i18n = useI18n()
  return <article className={cn('console-runtime-component', selected && 'is-selected')} style={position ? { gridColumn: position.column, gridRow: `${position.row} / span ${position.span}` } : undefined} onClick={(event) => {
    if ((event.target as Element).closest('button,a,input,textarea,summary')) return
    onSelect()
  }}>
    <GalleryPreview item={entry.item} readOnly={readOnly} />
    <ListItemButton id={`component-card-${entry.id}`} type="button" aria-label={i18n.t("查看 {0} 组件详情", [text(entry.item.name)])} aria-pressed={selected} onClick={onSelect}>
      <strong>{text(entry.item.name, i18n.t("未命名组件"))}</strong><small>{text(entry.item.owner, 'runtime')}</small>
    </ListItemButton>
  </article>
}

function EndpointGrid({ entries, selectedId, onSelect }: CollectionProps<'endpoints'>) {
  const i18n = useI18n()
  return (
    <div className="console-runtime-card-grid" aria-label={i18n.t("Endpoint 状态")}>
      {entries.map((entry) => {
        const online = entry.item.online === true || entry.item.connected === true
        const selected = entry.id === selectedId
        return (
          <div key={entry.id} className={cn('console-runtime-endpoint-shell', selected && 'is-selected')}>
            <SelectableCard {...{ entry, entries, selectedId, onSelect }} className="console-runtime-health-card">
              <span className={cn('console-runtime-health', online && 'is-online')}>{online ? <CheckCircle2 /> : <Unplug />}</span>
              <span className="console-runtime-card-main">
                <span className="flex items-center justify-between gap-2">
                  <small>{text(entry.item.adapter, 'adapter')}</small>
                  <span className="inline-flex items-center gap-1.5 text-xs">
                    <span className={cn('console-runtime-status-dot', online ? 'is-online' : 'is-offline')} aria-hidden="true" />
                    <span>{online ? i18n.t("已连接") : i18n.t("未连接")}</span>
                  </span>
                </span>
                <strong>{text(entry.item.name, i18n.t("未命名 Endpoint"))}</strong>
                <span>{text(entry.item.status, online ? i18n.t("已连接") : i18n.t("未连接"))}</span>
              </span>
            </SelectableCard>
            <div className="console-runtime-endpoint-actions">
              <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                <Link to="/endpoints"><MessageSquare className="size-3.5 mr-1" />{i18n.t("进入会话工作台")}</Link>
              </Button>
              <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                <Link to="/config"><Settings className="size-3.5 mr-1" />{i18n.t("管理配置")}</Link>
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function BindingMap({ entries, selectedId, onSelect }: CollectionProps<'bindings'>) {
  const i18n = useI18n()
  return (
    <div className="console-runtime-binding-list" aria-label={i18n.t("Agent 关系")}>
      {entries.map((entry) => {
        const servers = list(entry.item.mcpServers)
        return (
          <SelectableCard key={entry.id} {...{ entry, entries, selectedId, onSelect }} className="console-runtime-binding">
            <span className="console-runtime-node is-agent"><Bot /></span>
            <span className="console-runtime-card-main console-runtime-binding-agent"><small>Agent</small><strong>{text(entry.item.name)}</strong></span>
            <span className="console-runtime-edge"><ArrowRight /></span>
            <span className="console-runtime-node"><CircleDot /></span>
            <span className="console-runtime-card-main console-runtime-binding-provider"><small>{text(entry.item.provider, 'Provider')}</small><strong>{text(entry.item.model, i18n.t("默认模型"))}</strong></span>
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
  const i18n = useI18n()
  return (
    <div className="console-runtime-card-grid" aria-label={i18n.t("工具目录")}>
      {entries.map((entry) => (
        <SelectableCard key={entry.id} {...{ entry, entries, selectedId, onSelect }} className="console-runtime-tool-card">
          <span className="console-runtime-card-icon"><Wrench /></span>
          <span className="console-runtime-card-main">
            <strong>{text(entry.item.name, i18n.t("未命名工具"))}</strong>
            <small>{text(entry.item.description, i18n.t("没有提供工具说明"))}</small>
          </span>
          <Badge variant="outline">{text(entry.item.source, 'runtime')}</Badge>
        </SelectableCard>
      ))}
    </div>
  )
}

function PromptSectionCatalog({ entries, selectedId, onSelect }: CollectionProps<'prompt-sections'>) {
  const i18n = useI18n()
  return (
    <div className="console-runtime-prompt-list" aria-label={i18n.t("提示词片段目录")}>
      {entries.map((entry) => {
        const profiles = list(entry.item.profiles)
        const platforms = list(entry.item.platforms)
        const retention = text(entry.item.retention, 'preferred')
        const contentChars = text(entry.item.contentChars, '0')
        const maxChars = entry.item.maxChars == null ? i18n.t("未限制") : i18n.t("{0} 上限", [text(entry.item.maxChars)])
        return (
          <SelectableCard key={entry.id} {...{ entry, entries, selectedId, onSelect }} className="console-runtime-prompt-card">
            <span className="console-runtime-card-icon"><ScrollText /></span>
            <span className="console-runtime-card-main">
              <span className="console-runtime-prompt-heading">
                <strong>{text(entry.item.title, text(entry.item.name, i18n.t("未命名片段")))}</strong>
                <Badge variant={retention === 'required' ? 'warning' : retention === 'preferred' ? 'secondary' : 'outline'}>{retention}</Badge>
              </span>
              <small>{text(entry.item.owner, 'runtime')} · {text(entry.item.layer, 'context')} · {i18n.t("顺序")} {text(entry.item.order, '50')}</small>
              <span className="console-runtime-tags">
                {profiles.map((profile) => <Badge key={profile} variant="outline">{profile}</Badge>)}
                {platforms.map((platform) => <Badge key={platform} variant="secondary">{platform}</Badge>)}
                {!platforms.length ? <Badge variant="secondary">{i18n.t("全平台")}</Badge> : null}
              </span>
            </span>
            <span className="console-runtime-prompt-budget">
              <strong>{contentChars}</strong>
              <small>{i18n.t("字符上限")} · {maxChars}</small>
              <span>{i18n.t("代数")} {text(entry.item.generation, '—')}</span>
            </span>
          </SelectableCard>
        )
      })}
    </div>
  )
}

function McpGrid({ entries, selectedId, onSelect }: CollectionProps<'mcp'>) {
  const i18n = useI18n()
  return (
    <div className="console-runtime-card-grid" aria-label={i18n.t("MCP 服务")}>
      {entries.map((entry) => {
        const connected = entry.item.connected === true
        return (
          <SelectableCard key={entry.id} {...{ entry, entries, selectedId, onSelect }} className="console-runtime-mcp-card">
            <span className={cn('console-runtime-health', connected && 'is-online')}>{connected ? <PlugZap /> : <Unplug />}</span>
            <span className="console-runtime-card-main">
              <strong>{text(entry.item.name, i18n.t("未命名 MCP"))}</strong>
              <small>{connected ? i18n.t("{0} 个可用工具", [text(entry.item.toolCount, '0')]) : text(entry.item.error, i18n.t("连接不可用"))}</small>
            </span>
            <Badge variant={connected ? 'success' : 'destructive'}>{connected ? i18n.t("已连接") : i18n.t("未连接")}</Badge>
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

const STRUCTURED_KEYS = new Set([
  'previewProps',
  'pattern',
  'name',
  'desc',
  'description',
  'owner',
  'plugin',
  'source',
  'parameters',
  'aliases',
  'permissions',
  'profiles',
  'platforms',
  'mcpServers',
  'tools',
])

function CommandRunnerPanel({ item }: { item: CapabilityItem }) {
  const i18n = useI18n()
  const cacheScope = useInboxCacheScope()
  const primaryTrigger = useMemo(() => extractCommandTrigger(item, true), [item])
  const [commandText, setCommandText] = useState(primaryTrigger)
  const [endpoints, setEndpoints] = useState<PreviewEndpoint[]>([])
  const [endpointIndex, setEndpointIndex] = useState('')
  const [targetType, setTargetType] = useState<'private' | 'group' | 'channel'>('private')
  const [targetId, setTargetId] = useState('')
  const [loadingEndpoints, setLoadingEndpoints] = useState(false)
  const [sending, setSending] = useState(false)
  const [receipt, setReceipt] = useState<{ messageId?: string; adapter: string; endpointKey: string; channelType: string; channelId: string } | null>(null)
  const [runnerError, setRunnerError] = useState('')
  const loadSeqRef = useRef(0)
  const runSeqRef = useRef(0)

  useEffect(() => {
    setEndpoints([])
    setEndpointIndex('')
  }, [cacheScope])

  useEffect(() => {
    loadSeqRef.current++
    runSeqRef.current++
    setCommandText(primaryTrigger)
    setReceipt(null)
    setRunnerError('')
    setSending(false)
    setLoadingEndpoints(false)
  }, [primaryTrigger, cacheScope])

  async function loadChannels() {
    if (!isInboxCacheScopeActive(cacheScope)) return
    const seq = ++loadSeqRef.current
    setLoadingEndpoints(true)
    setRunnerError('')
    try {
      const rows = readPreviewEndpoints(await requestConsole({ type: ENDPOINT_RPC.LIST }), i18n.locale)
      if (seq !== loadSeqRef.current || !isInboxCacheScopeActive(cacheScope)) return
      setEndpoints(rows)
      if (rows.length && endpointIndex === '') {
        const onlineIndex = rows.findIndex((row) => row.connected)
        setEndpointIndex(String(onlineIndex >= 0 ? onlineIndex : 0))
      }
      if (!rows.length) {
        setRunnerError(i18n.t("当前 Host 没有可选择的账号；请先配置 Endpoint。"))
      }
    } catch (caught) {
      if (seq === loadSeqRef.current && isInboxCacheScopeActive(cacheScope)) {
        setRunnerError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      if (seq === loadSeqRef.current) {
        setLoadingEndpoints(false)
      }
    }
  }

  async function runCommand() {
    if (!isInboxCacheScopeActive(cacheScope)) return
    const selected = endpoints[Number(endpointIndex)]
    const trimmedCommand = commandText.trim()
    const trimmedTarget = targetId.trim()
    if (!selected) {
      setRunnerError(i18n.t("请选择目标 Endpoint"))
      return
    }
    if (!trimmedTarget) {
      setRunnerError(i18n.t("请选择会话类型并填写会话 ID"))
      return
    }
    if (!trimmedCommand) {
      setRunnerError(i18n.t("请输入要发送的命令内容"))
      return
    }
    const seq = ++runSeqRef.current
    setSending(true)
    setRunnerError('')
    setReceipt(null)
    try {
      const response = await requestConsole<{ messageId?: string }>({
        type: ENDPOINT_RPC.SEND_MESSAGE,
        adapter: selected.endpoint.adapter,
        endpointKey: selected.endpoint.id,
        channelId: trimmedTarget,
        channelType: targetType,
        content: trimmedCommand,
      })
      if (seq !== runSeqRef.current || !isInboxCacheScopeActive(cacheScope)) return
      setReceipt({
        messageId: response?.messageId,
        adapter: selected.endpoint.adapter,
        endpointKey: selected.endpoint.id,
        channelType: targetType,
        channelId: trimmedTarget,
      })
    } catch (caught) {
      if (seq === runSeqRef.current && isInboxCacheScopeActive(cacheScope)) {
        setRunnerError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      if (seq === runSeqRef.current) {
        setSending(false)
      }
    }
  }

  return (
    <section className="console-command-runner" aria-label={i18n.t("在线试跑 / 发送命令测试")}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Play className="size-3.5 text-primary" />
          {i18n.t("在线试跑 / 发送命令测试")}
        </span>
        <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={loadingEndpoints} onClick={() => void loadChannels()}>
          {loadingEndpoints ? <Loader2 className="size-3 animate-spin mr-1" /> : <RefreshCw className="size-3 mr-1" />}
          {i18n.t("加载渠道")}
        </Button>
      </div>
      <div className="mt-2.5 grid gap-2 text-xs">
        <label className="grid gap-1">
          <span className="text-muted-foreground">{i18n.t("命令内容")}</span>
          <Input
            aria-label={i18n.t("命令内容")}
            value={commandText}
            onChange={(event) => setCommandText(event.target.value)}
            placeholder={primaryTrigger || i18n.t("输入命令文本…")}
            className="font-mono text-xs"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground">{i18n.t("目标账号")}</span>
          <SelectField
            aria-label={i18n.t("目标账号")}
            className="w-full"
            value={endpointIndex}
            onValueChange={setEndpointIndex}
            options={[
              { value: '', label: endpoints.length ? i18n.t("请选择账号") : i18n.t("请先点击“加载渠道”") },
              ...endpoints.map((ep, idx) => ({
                value: String(idx),
                label: `${ep.name} · ${ep.endpoint.adapter}${ep.connected ? '' : i18n.t("（离线）")}`,
              })),
            ]}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1">
            <span className="text-muted-foreground">{i18n.t("会话类型")}</span>
            <SelectField
              aria-label={i18n.t("会话类型")}
              className="w-full"
              value={targetType}
              onValueChange={(value) => setTargetType(value as 'private' | 'group' | 'channel')}
              options={[
                { value: 'private', label: i18n.t("私聊") },
                { value: 'group', label: i18n.t("群聊") },
                { value: 'channel', label: i18n.t("频道") },
              ]}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-muted-foreground">{i18n.t("目标会话 ID")}</span>
            <Input
              aria-label={i18n.t("目标会话 ID")}
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
              placeholder={i18n.t("会话 ID")}
              className="text-xs"
            />
          </label>
        </div>
        {runnerError ? <p role="alert" className="text-xs text-destructive">{runnerError}</p> : null}
        {receipt ? (
          <div className="rounded-md border border-border/70 bg-background/80 p-2 text-xs">
            <p className="font-medium text-foreground">
              {i18n.t("已发送执行")}{receipt.messageId ? ` · ID: ${receipt.messageId}` : ''}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {receipt.adapter} / {receipt.endpointKey} → {receipt.channelType}:{receipt.channelId}
            </p>
            <Link
              to={`/endpoints/${encodeURIComponent(receipt.adapter)}/${encodeURIComponent(receipt.endpointKey)}?channelType=${encodeURIComponent(receipt.channelType)}&channelId=${encodeURIComponent(receipt.channelId)}`}
              className="mt-1 inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              {i18n.t("进入会话工作台查看完整对话")}<ArrowRight className="size-3" />
            </Link>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button type="button" size="sm" disabled={sending || endpointIndex === '' || !targetId.trim() || !commandText.trim()} onClick={() => void runCommand()}>
            {sending ? <Loader2 className="size-3.5 animate-spin mr-1.5" /> : <Play className="size-3.5 mr-1.5" />}
            {i18n.t("发送执行")}
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-8 text-xs">
            <Link to="/endpoints">{i18n.t("进入会话工作台")}<ArrowRight className="size-3.5 ml-1" /></Link>
          </Button>
        </div>
      </div>
    </section>
  )
}

function CapabilityInspector(props: {
  kind: IntrospectionTab
  item: CapabilityItem | null
  readOnly: boolean
}) {
  const i18n = useI18n()
  const { item, kind, readOnly } = props
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setCopied(false)
  }, [item, kind])

  if (!item) return null

  const owner = itemOwner(item)
  const description = typeof item.desc === 'string' && item.desc.trim()
    ? item.desc.trim()
    : typeof item.description === 'string' && item.description.trim()
      ? item.description.trim()
      : ''
  const parameters = list(item.parameters)
  const aliases = list(item.aliases)
  const permissions = list(item.permissions)
  const scopes = [...list(item.profiles), ...list(item.platforms), ...list(item.scopes)]
  const toolsAndServers = [...list(item.mcpServers), ...list(item.tools)]
  const endpointOnline = item.online === true || item.connected === true
  const extraDetails = Object.entries(item).filter(([key, value]) => !STRUCTURED_KEYS.has(key) && value != null && value !== '')

  async function copyCommandText() {
    if (!item) return
    const commandText = extractCommandTrigger(item, false)
    if (!commandText) return
    try {
      await navigator.clipboard?.writeText(commandText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Ignore clipboard permission errors
    }
  }

  return (
    <aside className="console-capability-inspector" aria-label={i18n.t("能力详情")}>
      <header>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="console-eyebrow">{kind === 'components' ? i18n.t("组件详情") : i18n.t("能力详情")}</span>
          {kind === 'endpoints' || kind === 'mcp' ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium">
              <span className={cn('console-runtime-status-dot', endpointOnline ? 'is-online' : 'is-offline')} aria-hidden="true" />
              <span>{endpointOnline ? i18n.t("已连接") : i18n.t("未连接")}</span>
            </span>
          ) : owner ? (
            <Badge variant="outline">{owner}</Badge>
          ) : null}
        </div>
        <h3 className={cn(kind === 'commands' && 'font-mono')}>{itemTitle(kind, item, i18n.locale)}</h3>
        {description ? <p>{description}</p> : null}
      </header>

      <div className="console-capability-inspector-actions">
        {kind === 'commands' ? (
          <Button type="button" size="sm" variant="outline" onClick={() => void copyCommandText()}>
            {copied ? <Check className="size-3.5 mr-1.5" /> : <Copy className="size-3.5 mr-1.5" />}
            {copied ? i18n.t("已复制") : i18n.t("复制命令")}
          </Button>
        ) : null}
        {kind === 'commands' && extractCommandTrigger(item, true) ? (
          <Button asChild size="sm" variant="outline"><Link to={permissionLinkFor(extractCommandTrigger(item, true), owner)}><ShieldCheck className="size-3.5 mr-1.5" />{i18n.t("查看此命令的权限说明")}</Link></Button>
        ) : null}
        {kind === 'bindings' ? (
          <Button asChild size="sm"><Link to="/agent/workbench">{i18n.t("查看机器人状态")}<ArrowRight /></Link></Button>
        ) : null}
        {kind === 'endpoints' ? (
          <>
            <Button asChild size="sm"><Link to="/endpoints">{i18n.t("进入会话工作台")}<ArrowRight /></Link></Button>
            <Button asChild size="sm" variant="outline"><Link to="/config"><Settings className="size-3.5 mr-1.5" />{i18n.t("管理配置")}</Link></Button>
          </>
        ) : null}
      </div>

      <div className="console-inspector-meta-grid">
        {owner ? (
          <div className="console-inspector-meta-card">
            <span>{i18n.t("所属插件")}</span>
            <strong>{owner}</strong>
          </div>
        ) : null}
        {item.phase != null || item.order != null ? (
          <div className="console-inspector-meta-card">
            <span>{i18n.t("阶段")} / {i18n.t("顺序")}</span>
            <strong>{text(item.phase, i18n.t("默认"))} · #{text(item.order, i18n.t("自动"))}</strong>
          </div>
        ) : null}
        {item.adapter != null ? (
          <div className="console-inspector-meta-card">
            <span>{i18n.t("适配器")}</span>
            <strong>{text(item.adapter)}</strong>
          </div>
        ) : null}
        {item.provider != null || item.model != null ? (
          <div className="console-inspector-meta-card">
            <span>{i18n.t("模型")}</span>
            <strong>{text(item.provider, i18n.t("默认"))} / {text(item.model, i18n.t("默认模型"))}</strong>
          </div>
        ) : null}
      </div>

      {parameters.length > 0 || aliases.length > 0 ? (
        <div className="console-inspector-section">
          <div className="console-inspector-section-title">
            <span>{i18n.t("参数")} & {i18n.t("别名")}</span>
            <Badge variant="secondary">{parameters.length}</Badge>
          </div>
          <div className="console-runtime-tags">
            {parameters.map((param, idx) => <Badge key={`param-${idx}`} variant="outline" className="font-mono">{param}</Badge>)}
            {aliases.map((alias, idx) => <Badge key={`alias-${idx}`} variant="secondary" className="font-mono">{alias}</Badge>)}
          </div>
        </div>
      ) : null}

      {permissions.length > 0 ? (
        <div className="console-inspector-section">
          <div className="console-inspector-section-title">
            <span>{i18n.t("权限")}</span>
            <Badge variant="warning">{permissions.length}</Badge>
          </div>
          <div className="console-runtime-tags">
            {permissions.map((perm, idx) => <Badge key={`perm-${idx}`} variant="warning"><ShieldCheck />{perm}</Badge>)}
          </div>
        </div>
      ) : null}

      {scopes.length > 0 || toolsAndServers.length > 0 ? (
        <div className="console-inspector-section">
          <div className="console-inspector-section-title">
            <span>{scopes.length > 0 ? i18n.t("适用平台") : i18n.t("MCP 服务")}</span>
          </div>
          <div className="console-runtime-tags">
            {scopes.map((scope, idx) => <Badge key={`scope-${idx}`} variant="secondary">{scope}</Badge>)}
            {toolsAndServers.map((tool, idx) => <Badge key={`tool-${idx}`} variant="outline">{tool}</Badge>)}
          </div>
        </div>
      ) : null}

      {extraDetails.length > 0 ? (
        <dl className="console-capability-properties">
          {extraDetails.slice(0, 8).map(([key, value]) => (
            <div key={key}><dt>{PROPERTY_LABELS[key] ? i18n.t(PROPERTY_LABELS[key]) : key}</dt><dd>{formatValue(value, i18n.locale)}</dd></div>
          ))}
        </dl>
      ) : null}

      {kind === 'commands' && !readOnly ? <CommandRunnerPanel item={item} /> : null}

      {Object.prototype.hasOwnProperty.call(item, 'previewProps') ? (
        <details className="mt-3 rounded-lg border border-border/70 bg-muted/20 p-2.5 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground">{i18n.t("示例参数")}</summary>
          <div className="mt-2"><JsonViewer value={item.previewProps} /></div>
        </details>
      ) : null}
      <details className="mt-3 rounded-lg border border-border/70 bg-muted/20 p-2.5 text-xs">
        <summary className="cursor-pointer font-medium text-muted-foreground">{i18n.t("查看 JSON 原文")}</summary>
        <div className="mt-2">
          <JsonViewer value={item} />
        </div>
      </details>
    </aside>
  )
}

function formatValue(value: unknown, locale: 'zh-CN' | 'en' = 'zh-CN'): ReactNode {
  if (typeof value === 'boolean') return <Badge variant={value ? 'success' : 'secondary'}>{value ? translate(locale, "是") : translate(locale, "否")}</Badge>
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">—</span>
    return <span className="console-runtime-tags">{value.map((entry, index) => <Badge key={`${String(entry)}-${index}`} variant="outline">{typeof entry === 'object' ? JSON.stringify(entry) : String(entry)}</Badge>)}</span>
  }
  if (typeof value === 'object') return <code>{JSON.stringify(value)}</code>
  return String(value)
}

