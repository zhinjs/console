import { routeLabel } from '../i18n/navigation'
import { translate } from '../i18n/locale.mjs'
import { useI18n } from '../i18n'
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
import { COMMAND_GROUP_ORDER, NAV_GROUPS } from '../navigation-taxonomy'

const RECENT_KEY = 'zhin.console.command-center.recent'
const RECENT_LIMIT = 5

const ROUTE_DESCRIPTIONS: Record<string, string> = {
  '/dashboard': '机器人是否正常、有什么要处理',
  '/sandbox': '与 Agent 对话并处理工作',
  '/tasks': '管理已配置的任务与执行记录',
  '/agent/workbench': '看看 AI 机器人是否准备好、最近做了什么',
  '/agent/workrooms': '按 Project 查看 Workroom Run、Task 与 Assignment',
  '/agent/workrooms/catalog': '配置协作空间、Bot Endpoint 与成员 Agent 映射',
  '/agent/sessions': '看看机器人和大家聊过什么，并从某段继续聊',
  '/endpoints': '查看聊天账号、群和好友申请',
  '/introspection': '检查命令、中间件、组件、Endpoint、Agent、工具与 MCP',
  '/logs': '查看出错、警告和运行过程',
  '/cron': '到点自动做事或发提醒',
  '/plugins': '开关和设置已装的功能',
  '/marketplace': '找新功能并安装',
  '/config': '配置模型、Agent 和插件',
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
  kind?: 'page' | 'action'
}

interface CommandGroup {
  label: string
  items: CommandTarget[]
}

const QUICK_ACTIONS: readonly CommandTarget[] = [
  {
    path: '/sandbox',
    title: '进入会话',
    group: '快捷动作',
    description: '与 Agent 对话并处理工作',
    icon: 'MessageSquare',
    kind: 'action',
  },
  {
    path: '/logs?level=error',
    title: '查看错误日志',
    group: '快捷动作',
    description: '只显示 error 级别的运行记录',
    icon: 'FileText',
    kind: 'action',
  },
  {
    path: '/introspection?tab=commands',
    title: '试运行命令',
    group: '快捷动作',
    description: '打开命令目录并检查参数契约',
    icon: 'Terminal',
    kind: 'action',
  },
  {
    path: '/introspection?tab=components',
    title: '预览消息组件',
    group: '快捷动作',
    description: '用真实消息渲染器检查组件输出',
    icon: 'Blocks',
    kind: 'action',
  },
  {
    path: '/agent/workrooms/catalog',
    title: '配置 Workroom 关系',
    group: '快捷动作',
    description: '管理 Project、协作空间、Bot 与 Agent 映射',
    icon: 'Network',
    kind: 'action',
  },
  {
    path: '/introspection?tab=tools',
    title: '检查 Agent 工具',
    group: '快捷动作',
    description: '查看 Tool Schema、来源与可用性',
    icon: 'Wrench',
    kind: 'action',
  },
]

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
  recentPaths: string[], locale: 'zh-CN' | 'en' = 'zh-CN'
): CommandGroup[] {
  const ranked = targets
    .map((target) => ({ target, score: commandScore(target, query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.target.title.localeCompare(right.target.title))
    .map((entry) => entry.target)

  if (query.trim()) return ranked.length ? [{ label: translate(locale, "搜索结果"), items: ranked }] : []

  const groups: CommandGroup[] = []
  const recent = recentPaths
    .map((path) => targets.find((target) => target.path === path))
    .filter((target): target is CommandTarget => target != null)
  if (recent.length) groups.push({ label: translate(locale, "最近访问"), items: recent })

  const recentSet = new Set(recent.map((target) => target.path))
  const byGroup = new Map<string, CommandTarget[]>()
  for (const target of ranked) {
    if (recentSet.has(target.path)) continue
    const items = byGroup.get(target.group) ?? []
    items.push(target)
    byGroup.set(target.group, items)
  }
  const labels = [...byGroup.keys()].sort((left, right) => {
    const order: readonly string[] = COMMAND_GROUP_ORDER
    const leftIndex = order.indexOf(left)
    const rightIndex = order.indexOf(right)
    return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex)
      || left.localeCompare(right)
  })
  for (const label of labels) groups.push({ label, items: byGroup.get(label) ?? [] })
  return groups
}

export function ConsoleCommandCenter({ routes }: { routes: readonly ConsoleRouteRecord[] }) {
  const i18n = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  const inputRef = useRef<HTMLInputElement>(null)
  const itemRefs = useRef(new Map<number, HTMLButtonElement>())
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [recentPaths, setRecentPaths] = useState<string[]>(() => readRecentPaths())
  const [shortcut, setShortcut] = useState('Ctrl K')

  const targets = useMemo<CommandTarget[]>(() => {
    const actions = QUICK_ACTIONS.filter(action => routes.some(route => route.path === action.path.split('?')[0]))
    return [
      ...actions.map(action => ({ ...action, title: i18n.t(action.title), description: i18n.t(action.description) })),
      ...routes
        .filter((route) => !route.meta?.hideInMenu && route.path && !actions.some(action => action.path === route.path))
        .map((route) => ({
          path: route.path,
          title: routeLabel(route, i18n.locale),
          group: route.meta?.group ?? NAV_GROUPS.PLUGINS,
          description: (ROUTE_DESCRIPTIONS[route.path] ? i18n.t(ROUTE_DESCRIPTIONS[route.path]) : undefined) ?? i18n.t("打开 {0}", [routeLabel(route, i18n.locale)]),
          icon: route.icon,
          kind: 'page' as const,
        })),
    ]
  }, [routes, i18n])
  const groups = useMemo(
    () => groupedTargets(targets, query, recentPaths, i18n.locale),
    [query, recentPaths, targets, i18n],
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
      <button type="button" className="console-command-trigger" onClick={() => setOpen(true)} aria-label={i18n.t("打开 Console 快速跳转")}>
        <Search aria-hidden="true" />
        <span className="hidden lg:inline">{i18n.t("搜索页面或执行动作")}</span>
        <span className="lg:hidden">{i18n.t("搜索与动作")}</span>
        <kbd>{shortcut}</kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="console-command-center gap-0 overflow-hidden p-0">
          <DialogTitle className="sr-only">Console Command Center</DialogTitle>
          <DialogDescription className="sr-only">{i18n.t("搜索 Console 页面或执行快捷动作")}</DialogDescription>

          <div className="console-command-search">
            <Search aria-hidden="true" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder={i18n.t("搜索页面或动作，例如“错误日志”“组件预览”…")}
              aria-label={i18n.t("搜索 Console 页面或快捷动作")}
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
              <section key={i18n.t(group.label)} className="console-command-group" role="group" aria-label={i18n.t(group.label)}>
                <div className="console-command-group-label">{i18n.t(group.label)}</div>
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
                        <span className="console-command-title">
                          {target.title}
                          {target.kind === 'action' ? <small>{i18n.t("动作")}</small> : null}
                        </span>
                        <span className="console-command-description">{target.description}</span>
                      </span>
                      {current ? <span className="console-command-current"><Check />{i18n.t("当前")}</span> : <ArrowRight />}
                    </button>
                  )
                })}
              </section>
            )) : (
              <div className="console-command-empty">
                <Search />
                <strong>{i18n.t("没有匹配的功能")}</strong>
                <span>{i18n.t("试试“Agent”“日志”“群组”或“配置”")}</span>
              </div>
            )}
          </div>

          <footer className="console-command-footer">
            <span><kbd>↑</kbd><kbd>↓</kbd>{i18n.t("选择")}</span>
            <span><kbd><CornerDownLeft /></kbd>{i18n.t("打开")}</span>
            <span><kbd>Esc</kbd>{i18n.t("关闭")}</span>
            <span className="ml-auto hidden sm:inline">{targets.length} {i18n.t(" 个入口")}</span>
          </footer>
        </DialogContent>
      </Dialog>
    </>
  )
}
