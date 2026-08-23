import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, Check, Command, CornerDownLeft, Search } from 'lucide-react'
import { cn, type ConsoleRouteRecord } from '@zhin.js/client'
import { getSidebarLucideIcon } from './sidebarMenuIcons'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './ui/dialog'

const RECENT_KEY = 'zhin.console.command-center.recent'
const RECENT_LIMIT = 5
const COMMAND_GROUP_ORDER = ['Agent 工作台', '渠道与会话', '自动化', '运行时', '扩展', '运维', '总览', '其他']

const ROUTE_DESCRIPTIONS: Record<string, string> = {
  '/dashboard': '检查运行健康度与待处理事项',
  '/agent/workbench': '确认 Agent、工具、MCP 与渠道就绪状态',
  '/agent/workrooms': '按 Project 查看 Workroom Run、Task 与 Assignment',
  '/agent/workrooms/catalog': '配置协作空间、Bot Endpoint 与成员 Agent 映射',
  '/agent/sessions': '浏览持久化会话与对话分支',
  '/endpoints': '管理 Bot Endpoint、群组、频道和收件箱',
  '/introspection': '检查命令、中间件、组件、Endpoint、Agent、工具与 MCP',
  '/logs': '定位错误、警告与运行事件',
  '/cron': '查看和管理计划任务',
  '/plugins': '检查已安装插件与运行状态',
  '/marketplace': '发现并安装新的适配器与能力',
  '/config': '编辑项目配置并查看配置结构',
  '/env': '管理运行环境变量',
  '/files': '浏览和编辑项目文件',
  '/database': '检查数据表、记录与持久化状态',
}

interface CommandTarget {
  path: string
  title: string
  group: string
  description: string
  icon?: React.ReactNode | string
}

interface CommandGroup {
  label: string
  items: CommandTarget[]
}

function readRecentPaths(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function rememberPath(path: string): string[] {
  const next = [path, ...readRecentPaths().filter((item) => item !== path)].slice(0, RECENT_LIMIT)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // Navigation remains available when storage is disabled or quota-limited.
  }
  return next
}

function commandScore(target: CommandTarget, rawQuery: string): number {
  const query = rawQuery.trim().toLocaleLowerCase()
  if (!query) return 1
  const title = target.title.toLocaleLowerCase()
  const path = target.path.toLocaleLowerCase()
  const group = target.group.toLocaleLowerCase()
  const description = target.description.toLocaleLowerCase()
  const terms = query.split(/\s+/u).filter(Boolean)
  if (!terms.every((term) => `${title} ${path} ${group} ${description}`.includes(term))) return 0
  return terms.reduce((score, term) => {
    if (title === term) return score + 120
    if (title.startsWith(term)) return score + 90
    if (title.includes(term)) return score + 70
    if (group.includes(term)) return score + 45
    if (description.includes(term)) return score + 35
    if (path.includes(term)) return score + 20
    return score
  }, 0)
}

function groupedTargets(
  targets: CommandTarget[],
  query: string,
  recentPaths: string[],
): CommandGroup[] {
  const ranked = targets
    .map((target) => ({ target, score: commandScore(target, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.target.title.localeCompare(right.target.title))
    .map((entry) => entry.target)

  if (query.trim()) return ranked.length ? [{ label: '搜索结果', items: ranked }] : []

  const groups: CommandGroup[] = []
  const recent = recentPaths
    .map((path) => targets.find((target) => target.path === path))
    .filter((target): target is CommandTarget => target != null)
  if (recent.length) groups.push({ label: '最近访问', items: recent })

  const recentSet = new Set(recent.map((target) => target.path))
  const byGroup = new Map<string, CommandTarget[]>()
  for (const target of ranked) {
    if (recentSet.has(target.path)) continue
    const items = byGroup.get(target.group) ?? []
    items.push(target)
    byGroup.set(target.group, items)
  }
  const labels = [...byGroup.keys()].sort((left, right) => {
    const leftIndex = COMMAND_GROUP_ORDER.indexOf(left)
    const rightIndex = COMMAND_GROUP_ORDER.indexOf(right)
    return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex)
      || left.localeCompare(right)
  })
  for (const label of labels) groups.push({ label, items: byGroup.get(label) ?? [] })
  return groups
}

export function ConsoleCommandCenter({ routes }: { routes: readonly ConsoleRouteRecord[] }) {
  const navigate = useNavigate()
  const location = useLocation()
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef(new Map<number, HTMLButtonElement>())
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [recentPaths, setRecentPaths] = useState<string[]>(() => readRecentPaths())
  const [shortcut, setShortcut] = useState('Ctrl K')

  const targets = useMemo<CommandTarget[]>(() => routes
    .filter((route) => !route.meta?.hideInMenu && route.path)
    .map((route) => ({
      path: route.path,
      title: route.name,
      group: route.meta?.group ?? '其他',
      description: ROUTE_DESCRIPTIONS[route.path] ?? `打开 ${route.name}`,
      icon: route.icon,
    })), [routes])
  const groups = useMemo(
    () => groupedTargets(targets, query, recentPaths),
    [query, recentPaths, targets],
  )
  const visibleTargets = useMemo(() => groups.flatMap((group) => group.items), [groups])

  useEffect(() => {
    setShortcut(/Mac|iPhone|iPad/u.test(navigator.platform) ? '⌘ K' : 'Ctrl K')
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
        setOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIndex(0)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  useEffect(() => {
    itemRefs.current.get(selectedIndex)?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const runTarget = (target: CommandTarget) => {
    setRecentPaths(rememberPath(target.path))
    setOpen(false)
    if (target.path !== `${location.pathname}${location.search}`) navigate(target.path)
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setSelectedIndex((index) => visibleTargets.length ? (index + 1) % visibleTargets.length : 0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setSelectedIndex((index) => visibleTargets.length
        ? (index - 1 + visibleTargets.length) % visibleTargets.length
        : 0)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const target = visibleTargets[selectedIndex]
      if (target) runTarget(target)
    }
  }

  let runningIndex = 0
  return (
    <>
      <button type="button" className="console-command-trigger" onClick={() => setOpen(true)} aria-label="打开 Console 快速跳转">
        <Search aria-hidden="true" />
        <span className="hidden lg:inline">跳转到 Console 页面</span>
        <span className="lg:hidden">快速跳转</span>
        <kbd>{shortcut}</kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="console-command-center gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">Console Command Center</DialogTitle>
          <DialogDescription className="sr-only">搜索并打开 Console 页面</DialogDescription>

          <div className="console-command-search">
            <Search aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="搜索 Agent、Workroom、渠道或设置…"
              aria-label="搜索 Console 页面"
              role="combobox"
              aria-expanded="true"
              aria-controls="console-command-results"
              aria-activedescendant={visibleTargets[selectedIndex] ? `console-command-${selectedIndex}` : undefined}
              autoComplete="off"
            />
            {query ? <span className="console-command-count">{visibleTargets.length}</span> : <Command />}
          </div>

          <div id="console-command-results" className="console-command-results" role="listbox">
            {groups.length ? groups.map((group) => (
              <section key={group.label} className="console-command-group" role="group" aria-label={group.label}>
                <div className="console-command-group-label">{group.label}</div>
                {group.items.map((target) => {
                  const itemIndex = runningIndex++
                  const Icon = typeof target.icon === 'string' ? getSidebarLucideIcon(target.icon) : null
                  const selected = itemIndex === selectedIndex
                  const current = location.pathname === target.path
                    || location.pathname.startsWith(`${target.path}/`)
                  return (
                    <button
                      key={target.path}
                      id={`console-command-${itemIndex}`}
                      ref={(node) => {
                        if (node) itemRefs.current.set(itemIndex, node)
                        else itemRefs.current.delete(itemIndex)
                      }}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={cn('console-command-item', selected && 'is-selected')}
                      onMouseEnter={() => setSelectedIndex(itemIndex)}
                      onClick={() => runTarget(target)}
                    >
                      <span className="console-command-icon">{Icon ? <Icon /> : target.icon}</span>
                      <span className="min-w-0 flex-1 text-left">
                        <span className="console-command-title">{target.title}</span>
                        <span className="console-command-description">{target.description}</span>
                      </span>
                      {current ? <span className="console-command-current"><Check />当前</span> : <ArrowRight />}
                    </button>
                  )
                })}
              </section>
            )) : (
              <div className="console-command-empty">
                <Search />
                <strong>没有匹配的功能</strong>
                <span>试试“Agent”“日志”“群组”或“配置”</span>
              </div>
            )}
          </div>

          <footer className="console-command-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd>选择</span>
            <span><kbd><CornerDownLeft /></kbd>打开</span>
            <span><kbd>Esc</kbd>关闭</span>
            <span className="ml-auto hidden sm:inline">{targets.length} 个入口</span>
          </footer>
        </DialogContent>
      </Dialog>
    </>
  )
}
